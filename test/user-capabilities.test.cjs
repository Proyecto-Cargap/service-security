/** @file Regresiones de consulta y autenticación después de separar los casos de uso de usuario. */
'use strict';
const test       = require('node:test');
const assert     = require('node:assert/strict');
const createUser = require('../server/modules/user/services/user.service');
const {
  userCredentialsService,
} = require('../server/modules/user/services/user-credentials.service');
const {
  requireCapability,
} = require('../server/modules/security/ports/security-dependencies.port');

/** Construye una instancia sin SDK ni repositorios reales; registra los efectos observados.
 * @param {string} userCode Identidad del usuario simulado.
 * @returns {Object} Servicio y efectos de la instancia aislada.
 */
function fixture(userCode) {
  const row     = {
    _id      : userCode,
    userCode,
    password : 'hash',
    state    : 'active',
    erased   : false,
    validity : Date.now() + 60000,
  };
  const writes  = [];
  const service = createUser({
    messaging      : {
      /**
       * Ejecuta getContext y devuelve el resultado al flujo que lo invoca.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      getContext  : () => ({}),
      /**
       * Ejecuta sendCommand y devuelve el resultado al flujo que lo invoca.
       * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      sendCommand : async () => {
        throw new Error('UNEXPECTED_NOTIFICATION');
      },
    },
    settings       : {
      /**
       * Ejecuta get y devuelve el resultado al flujo que lo invoca.
       * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      get : async () => ({ data: { maximumFailedAttempts: 3 } }),
    },
    repositories   : {
      user    : {
        /**
         * Ejecuta getOne y devuelve el resultado al flujo que lo invoca.
         * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
         */
        getOne : async () => ({ ...row }),

        /**
         * Ejecuta update y devuelve el resultado al flujo que lo invoca.
         * @param {*} filter Valor utilizado por la operación.
         * @param {*} update Valor utilizado por la operación.
         * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
         */
        update : async (filter, update) => {
          writes.push({
            filter,
            update,
          });
          return {
            ...row,
            ...update.$set,
          };
        },
      },
      session : {},
    },
    jwt            : {},
    passwordHasher : {
      /**
       * Ejecuta compare y devuelve el resultado al flujo que lo invoca.
       * @param {*} value Valor utilizado por la operación.
       * @param {*} hash Valor utilizado por la operación.
       * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      compare : async (value, hash) => value === 'correct' && hash === 'hash',
    },
    tokenContexts  : require('../server/adapters/security/token-contexts').tokenContexts({
      PLATFORM_ID : 'fixture',
      ENV_NAME    : 'test',
    }),
    tokenSecret    : 'test-only',
  });
  return {
    service,
    writes,
  };
}

test('consulta y autenticación comparten estado únicamente dentro de su propia instancia' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, async () => {
  const first  = fixture('first');
  const second = fixture('second');
  assert.equal((await first.service.getOne({ userCode: 'first' })).userCode, 'first');
  assert.equal((await second.service.getOne({ userCode: 'second' })).userCode, 'second');
  assert.equal(await first.service.authentication('correct'), true);
  assert.equal(first.writes.length, 1);
  assert.equal(first.writes[0].filter.erased, false);
  assert.equal(first.writes[0].update.$set.numberAttemptsAccess, 0);
  assert.equal(second.writes.length, 0);
  assert.equal(await second.service.authentication('correct'), true);
  assert.equal(second.writes[0].filter._id, 'second');
});

test('contraseña incorrecta mantiene el error y contabiliza el intento sin conceder acceso' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, async () => {
  const { service, writes } = fixture('user');
  await service.getOne({ userCode: 'user' });
  await assert.rejects(
    service.authentication('wrong'),
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} error Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (error) => error.statusCode === 406,
  );
  assert.equal(writes.length, 1);
  assert.equal(writes[0].update.$set.numberAttemptsAccess, 1);
});

test('la recuperación funciona con su colaborador mínimo y admite otra implementación' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, async () => {
  for (const suffix of ['memory', 'alternative']) {
    const calls   = [];
    const service = userCredentialsService({
      passwordRecovery : {
        /**
         * Ejecuta request y devuelve el resultado al flujo que lo invoca.
         * @param {*} input Valor utilizado por la operación.
         * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
         */
        request : async (input) => {
          calls.push(input);
          return suffix;
        },

        /**
         * Ejecuta reset y devuelve el resultado al flujo que lo invoca.
         * @param {*} input Valor utilizado por la operación.
         * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
         */
        reset   : async (input) => {
          calls.push(input);
          return suffix;
        },
      },
    });
    assert.equal(await service.recoverPassword({ user: 'u' }), suffix);
    assert.equal(await service.updatePassword({ token: 't' }), suffix);
    assert.deepEqual(calls, [{ user: 'u' }, { token: 't' }]);
  }
});

test('el contrato de construcción falla antes de invocar métodos y conserva identidad y errores' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, async () => {
  let calls   = 0;
  const cause = new Error('unavailable');
  const port  = {
    /**
     * Ejecuta read y devuelve el resultado al flujo que lo invoca.
     * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    read : async () => {
      calls++;
      throw cause;
    },
  };
  assert.equal(requireCapability(port, ['read'], 'reader'), port);
  assert.equal(calls, 0);
  assert.throws(
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    () => requireCapability(port, ['write'], 'writer'),
    /INVALID_CAPABILITY:writer.write/,
  );
  await assert.rejects(
    port.read(),
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} error Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (error) => error === cause,
  );
  assert.equal(calls, 1);
});

/** Comprueba que la composición conserva sustituciones y falla antes de registrar acciones incompletas. */
test('la composición conecta fábricas y conserva el contrato de consulta de roles sin cargar modelos' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {Promise<void>} Verifica composición, consulta de catálogos y guardado aislado.
 */, async () => {
  const {
    securityDependencies,
  } = require('../server/modules/security/compositions/security-dependencies.composition');
  /** Falla si la validación intenta ejecutar un método de persistencia o transporte.
   * @returns {never} La composición sólo debe acreditar capacidades, sin producir efectos.
   */
  function unexpectedCall() {
    assert.fail('UNEXPECTED_COMPOSITION_EFFECT');
  }
  const {
    REPOSITORY_CAPABILITIES,
  } = require('../server/modules/security/ports/security-dependencies.port');
  const repository = {};
  for (const methods of Object.values(REPOSITORY_CAPABILITIES))
    for (const method of methods) repository[method] = unexpectedCall;
  const input    = {
    settings          : {
      get    : unexpectedCall,
      getAll : unexpectedCall,
      update : unexpectedCall,
    },
    counter           : { getObjectCode: unexpectedCall },
    workspacePictures : {
      upload : unexpectedCall,
      remove : unexpectedCall,
    },
    messaging         : {
      getContext      : unexpectedCall,
      request         : unexpectedCall,
      sendCommand     : unexpectedCall,
      publishEvent    : unexpectedCall,
      transaction     : unexpectedCall,
      registerAction  : unexpectedCall,
      successResponse : unexpectedCall,
      errorResponse   : unexpectedCall,
    },
    repositories      : Object.fromEntries(
      Object.keys(REPOSITORY_CAPABILITIES).map(
        /**
         * Aplica la operación local y devuelve su resultado al flujo que la invoca.
         * @param {*} name Valor utilizado por la operación.
         * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
         */
        (name) => [name, repository],
      ),
    ),
    jwt               : {
      /**
       * Ejecuta sign y devuelve el resultado al flujo que lo invoca.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      sign() {},
      /**
       * Ejecuta verify y devuelve el resultado al flujo que lo invoca.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      verify() {},
      /**
       * Ejecuta decode y devuelve el resultado al flujo que lo invoca.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      decode() {},
    },
    passwordHasher    : {
      /**
       * Ejecuta hash y devuelve el resultado al flujo que lo invoca.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      hash() {},
      /**
       * Ejecuta compare y devuelve el resultado al flujo que lo invoca.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      compare() {},
    },
    tokenContexts     : require('../server/adapters/security/token-contexts').tokenContexts({
      PLATFORM_ID : 'fixture',
      ENV_NAME    : 'test',
    }),
    tokenSecret       : 'test-only',

    /**
     * Ejecuta roleLabels y devuelve el resultado al flujo que lo invoca.
     * @returns {Promise<*>} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    roleLabels        : async () => ({}),
  };
  const before   = Object.keys(require.cache).filter(
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} filename Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (filename) => filename.endsWith('.model.js'),
  );
  const composed = securityDependencies(input);
  assert.equal(composed.repositories.user, repository);
  assert.equal(composed.jwt, input.jwt);
  assert.equal(composed.workspacePictures, input.workspacePictures);
  assert.equal(typeof composed.services.user, 'function');
  assert.deepEqual(
    Object.keys(require.cache).filter(
      /**
       * Aplica la operación local y devuelve su resultado al flujo que la invoca.
       * @param {*} filename Valor utilizado por la operación.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      (filename) => filename.endsWith('.model.js'),
    ),
    before,
  );
  assert.throws(
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    () =>
      securityDependencies({
        ...input,
        tokenSecret : ' ',
      }),
    /INVALID_CONFIGURATION:tokenSecret/,
  );
  const writes   = [];
  const requests = [];
  let roleResponse;
  const connected = securityDependencies({
    ...input,
    messaging    : {
      ...input.messaging,
      /** @returns {Object} Contexto con permisos globales de configuración y consulta. */
      getContext : () => ({
        user     : { userCode: 'admin' },
        policies : [
          'security.settings.update.global',
          'directory.role.view.global',
          'security.group.view.global',
        ],
      }),
      /** Conserva el contrato canónico role-get-one: el identificador de entrada es code.
       * @param {string} target Servicio destinatario. @param {string} action Acción RPC.
       * @param {Object} data Mensaje enviado por la composición real.
       * @returns {Promise<Object>} Sobre de Directory; rechaza el campo incorrecto antes de guardar.
       */
      async request(target, action, data) {
        assert.equal(target, 'service-directory');
        assert.equal(action, 'role-get-one');
        requests.push(data);
        if (!data.code)
          return {
            statusCode      : 400,
            descriptionCode : 'ROLE_CODE_REQUIRED',
          };
        assert.deepEqual(Object.keys(data), ['code']);
        return (
          roleResponse ?? {
            statusCode : 200,
            data       : {
              roleCode : data.code,
              active   : true,
              erased   : false,
            },
          }
        );
      },
      /** @returns {Promise<void>} Registra el aviso después de la escritura aislada. */
      async sendCommand() {
        writes.push('notify');
      },
    },
    repositories : {
      ...input.repositories,
      group : {
        ...repository,
        /** @param {Object} filter Selector del perfil. @param {string} scope Alcance autorizado.
         * @returns {Promise<Object>} Perfil global vigente; no usa el alcance interno para editar configuración.
         */
        async getOne(filter, scope) {
          assert.equal(filter.workspace, 'allWorkspaces');
          assert.equal(filter.erased, false);
          assert.equal(scope, '');
          return {
            groupCode : filter.groupCode,
            workspace : 'allWorkspaces',
            erased    : false,
          };
        },
      },
    },
    settings     : {
      ...input.settings,
      /** @param {string} parameter Parámetro. @param {Object} data Cambios validados. @param {string} scope Alcance.
       * @returns {Promise<Object>} Confirmación aislada de persistencia.
       */
      async update(parameter, data, scope) {
        writes.push({
          parameter,
          data : structuredClone(data),
          scope,
        });
        return {
          parameter,
          data,
        };
      },
    },
  });
  const service   = connected.services.settings(connected);
  const changes   = {
    parameter : 'user-setings',
    scope     : 'global',
    data      : {
      defaultGroupsByRole : [
        {
          roleCode   : 'ROL-200-CUSTOMER',
          groupCodes : ['customer-admin'],
        },
        {
          roleCode   : 'ROL-300-SUPPLIER',
          groupCodes : ['supplier-admin'],
        },
      ],
    },
  };
  await service.update(changes);
  assert.deepEqual(requests, [{ code: 'ROL-200-CUSTOMER' }, { code: 'ROL-300-SUPPLIER' }]);
  assert.deepEqual(writes, [changes]);
  for (const [response, expected] of [
    [
      { statusCode: 404 },
      {
        statusCode      : 409,
        descriptionCode : 'INVALID_DEFAULT_ROLE',
      },
    ],
    [
      { statusCode: 403 },
      {
        statusCode      : 403,
        descriptionCode : 'DEFAULT_ROLE_UNAVAILABLE',
      },
    ],
    [
      { statusCode: 503 },
      {
        statusCode      : 503,
        descriptionCode : 'DEFAULT_ROLE_UNAVAILABLE',
      },
    ],
    [
      {
        statusCode : 200,
        data       : { roleCode: 'other' },
      },
      {
        statusCode      : 503,
        descriptionCode : 'DEFAULT_ROLE_UNAVAILABLE',
      },
    ],
  ]) {
    roleResponse = response;
    await assert.rejects(service.update(changes), expected);
    assert.equal(writes.length, 1);
  }
});
