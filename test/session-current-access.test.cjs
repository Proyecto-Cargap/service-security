/** @file Autorización de sesión sin paginación administrativa, caché de permisos ni escrituras de acceso innecesarias. */
'use strict';
const test                 = require('node:test');
const assert               = require('node:assert/strict');
const { ApplicationError } = require('../server/shared/application-error');
const {
  sessionAuthorizationWorkflowService,
} = require('../server/modules/session/services/session-authorization-workflow.service');

/** @returns {Promise<void>} Sin bloqueo por defecto. */
async function noBarrier() {}
/** @param {Function} [beforeRead] Control explícito de cada lectura en las pruebas de concurrencia. @returns {Object} Sesión y permisos mutables para comprobar revocaciones consecutivas. */
function fixture(beforeRead = noBarrier) {
  const state   = {
    writes     : 0,
    reads      : 0,
    permission : true,
    workspace  : {},
    session    : {
      _id             : 's',
      activeWorkspace : 'w',
      workspaces      : ['w'],
      lastAccess      : Date.now(),
      expiration      : 9999999999,
    },
    user       : {
      userCode   : 'u',
      userType   : 'internal',
      state      : 'active',
      validity   : Date.now() + 60000,
      workspaces : ['w'],
      groups     : ['g'],
    },
  };
  const service = sessionAuthorizationWorkflowService({
    ApplicationError,
    dependencies      : {
      tokenSecret  : 'fixture',
      repositories : {
        authentication : {
          /** @returns {Promise<Object|null>} Una instantánea actual por solicitud, sin caché. */
          async read() {
            await beforeRead('access');
            state.reads++;
            return state.session
              ? {
                  session   : structuredClone(state.session),
                  user      : structuredClone(state.user),
                  workspace : state.workspace,
                  policies  : state.permission ? ['read'] : [],
                }
              : null;
          },
        },
      },
    },
    jwt               : {
      /** @returns {Object} Firma validada por el puerto aislado. */ verify() {
        return { user: { userCode: 'u' } };
      },
    },
    tokenContexts     : { session: {} },
    sessionRepository : {
      /** @returns {Promise<Object|null>} Sesión vigente o revocada. */ async getOne() {
        await beforeRead('session');
        return state.session;
      },
      /** @returns {Promise<void>} Cuenta escrituras reales solicitadas. */ async refreshAccess() {
        state.writes++;
      },
    },
    logger            : { /** @returns {void} Los fallos no exportan datos de autenticación. */ error() {} },
    userScopes        : {},
    sessionScopes     : {},
    workspacesScopes  : {},
    groupScopes       : {},
    policyScopes      : {},
  });
  return {
    state,
    service,
  };
}

test('permisos actuales usan una lectura y reflejan bajas en la siguiente solicitud', /** @returns {Promise<void>} No requiere conteos, páginas ni TTL de permisos. */ async () => {
  const { state, service } = fixture();
  assert.deepEqual(
    (
      await service.authenticate({
        token           : 'valid',
        currentPolicies : true,
        refreshAccess   : true,
      })
    ).policies,
    ['read'],
  );
  assert.equal(state.reads, 1);
  assert.equal(state.writes, 0);
  state.permission = false;
  state.session.lastAccess = Date.now() - 300001;
  assert.deepEqual(
    (
      await service.authenticate({
        token           : 'valid',
        currentPolicies : true,
        refreshAccess   : true,
      })
    ).policies,
    [],
  );
  assert.equal(state.reads, 2);
  assert.equal(state.writes, 1);
  state.session = null;
  await assert.rejects(
    service.authenticate({
      token           : 'valid',
      currentPolicies : true,
    }),
    { statusCode: 401 },
  );
  assert.equal(state.reads, 3);
});

test('cambios de credenciales y membresía rechazan antes de entregar permisos', /** @returns {Promise<void>} Preserva ambas cercas vigentes. */ async () => {
  for (const mutation of ['credentialsChangedAt', 'workspaces']) {
    const { state, service } = fixture();
    state.user[mutation] = mutation === 'workspaces' ? [] : 1;
    await assert.rejects(
      service.authenticate({
        token           : 'valid',
        currentPolicies : true,
      }),
      { statusCode: 401 },
    );
    assert.equal(state.reads, 1);
  }
});

test(
  'solicitudes concurrentes conservan lecturas propias y no comparten autorizaciones',
  { timeout: 5000 },
  /** @returns {Promise<void>} La consulta posterior no hereda permisos de una anterior todavía pendiente. */ async () => {
    const barrier            = Promise.withResolvers();
    let entered              = 0;
    const { service, state } = fixture(
      /** @returns {Promise<void>} Detiene sólo la primera petición. */ async () => {
        if (++entered === 1) await barrier.promise;
      },
    );
    const first              = service.authenticate({
      token           : 'valid',
      currentPolicies : true,
    });
    state.permission = false;
    assert.deepEqual(
      (
        await service.authenticate({
          token           : 'valid',
          currentPolicies : true,
        })
      ).policies,
      [],
    );
    barrier.resolve();
    assert.deepEqual((await first).policies, []);
    assert.equal(state.reads, 2);
  },
);
test('sesión y workspace revocados impiden la entrega de identidad', /** @returns {Promise<void>} Cada ausencia conserva su denegación explícita. */ async () => {
  for (const kind of ['session', 'workspace', 'user']) {
    const { service, state } = fixture();
    state[kind] = null;
    await assert.rejects(
      service.authenticate({
        token           : 'valid',
        currentPolicies : true,
      }),
      { statusCode: 401 },
    );
  }
});
test('un fallo de la lectura coherente no emite una identidad parcial', /** @returns {Promise<void>} La dependencia caída cierra el acceso. */ async () => {
  const { service } = fixture(
    /** @returns {never} Simula indisponibilidad de persistencia. */ async () => {
      throw new Error('UNAVAILABLE');
    },
  );
  await assert.rejects(
    service.authenticate({
      token           : 'valid',
      currentPolicies : true,
    }),
    { statusCode: 503 },
  );
});
