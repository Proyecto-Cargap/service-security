/** @file Verifica el contacto propio obtenido de la cuenta autenticada y su contrato público. */
'use strict';
const test           = require('node:test');
const assert         = require('node:assert/strict');
const createProfile  = require('../server/modules/session/services/session-own-profile.service');
const { actionDtos } = require('../server/contracts');

/** @param {string|null} contactCode Vínculo persistido del usuario. @returns {Object} Caso de uso con identidad y colaboradores mínimos controlados. */
function fixture(contactCode = 'contact-a') {
  const context = {
    sessionCode : 'session-a',
    user        : { userCode: 'user-a' },
    workspace   : 'workspace-a',
  };
  const calls   = [];
  const user    = {
    user       : 'user@example.test',
    contactCode,
    roleCode   : 'role-a',
    userType   : 'human',
    workspaces : ['workspace-a'],
  };
  const profile = {
    statusCode : 200,
    data       : {
      fullName   : 'Usuario de prueba',
      revision   : 12,
      hasPicture : false,
    },
  };
  const service = createProfile({
    messaging : {
      /** @returns {Object} Contexto acreditado por el transporte. */
      getContext() {
        return context;
      },
      /** @param {string} serviceName Servicio destinatario. @param {string} action Operación canónica. @param {Object} data Identidad resuelta por Security. @returns {Promise<Object>} Proyección mínima del contacto. */
      async request(serviceName, action, data) {
        calls.push({
          serviceName,
          action,
          data,
        });
        return profile;
      },
    },
    sessions  : {
      /** @param {Object} filter Filtro de sesión vigente. @returns {Promise<Object>} Sesión vinculada al usuario autenticado. */
      async getOne(filter) {
        assert.equal(filter.userCode, context.user.userCode);
        return {
          userCode        : filter.userCode,
          activeWorkspace : 'workspace-a',
        };
      },
    },
    users     : {
      /** @param {Object} filter Cuenta derivada de la sesión. @returns {Promise<Object>} Usuario persistido, sin datos elegidos por el cliente. */
      async getList(filter) {
        assert.equal(filter.userCode, context.user.userCode);
        return { listItem: [user] };
      },
    },
    /** @returns {Promise<Map>} Etiquetas de roles de la cuenta. */
    async roleLabels() {
      return new Map([['role-a', 'Usuario']]);
    },
  });
  return {
    service,
    context,
    user,
    profile,
    calls,
  };
}

test('dos sesiones reciben el contacto vinculado a su propia cuenta y cumplen el DTO' /** @returns {Promise<void>} Acredita aislamiento de identidad y proyección explícita. */, async () => {
  for (const suffix of ['a', 'b']) {
    const f = fixture('contact-' + suffix);
    f.context.user.userCode = 'user-' + suffix;
    const result = await f.service.get();
    assert.equal(result.contactCode, 'contact-' + suffix);
    assert.equal(result.pictureRevision, 12);
    assert.deepEqual(f.calls, [
      {
        serviceName : 'service-directory',
        action      : 'contact-profile-get-one',
        data        : { contactCode: 'contact-' + suffix },
      },
    ]);
    assert.deepEqual(
      actionDtos['session-own-profile-get'].output({
        statusCode : 200,
        data       : result,
      }).data,
      result,
    );
    assert.deepEqual(Object.keys(result).sort(), [
      'contactCode',
      'email',
      'fullName',
      'pictureRevision',
      'pictureUrl',
      'roleName',
    ]);
  }
});

test('la cuenta sin vínculo devuelve contactCode null sin consultar otro contacto' /** @returns {Promise<void>} Conserva la ausencia real y el contrato nullable. */, async () => {
  const f      = fixture(null);
  const result = await f.service.get();
  assert.equal(result.contactCode, null);
  assert.equal(result.fullName, null);
  assert.deepEqual(f.calls, []);
  actionDtos['session-own-profile-get'].output({
    statusCode : 200,
    data       : result,
  });
});

test('el DTO no admite seleccionar un contacto ajeno ni omitir el vínculo en la salida' /** @returns {void} Rechaza suplantación y salidas incompletas. */, () => {
  const dto = actionDtos['session-own-profile-get'];
  assert.throws(
    /** @returns {Object} Entrada que intenta elegir otra identidad. */
    () => dto.input({ contactCode: 'other' }),
    { statusCode: 400 },
  );
  assert.throws(
    /** @returns {Object} Salida sin el nuevo campo obligatorio. */
    () =>
      dto.output({
        statusCode : 200,
        data       : {
          fullName   : null,
          email      : null,
          roleName   : null,
          pictureUrl : null,
        },
      }),
    { statusCode: 500 },
  );
});

test('el fallo de Directory se propaga y una identidad no humana sigue sin acceso' /** @returns {Promise<void>} No convierte un fallo técnico o una denegación en un perfil disponible. */, async () => {
  const f = fixture();
  f.profile.statusCode = 503;
  await assert.rejects(f.service.get(), {
    statusCode      : 503,
    descriptionCode : 'SESSION_REFERENCES_UNAVAILABLE',
  });
  f.context.actorType = 'agent';
  await assert.rejects(f.service.get(), { statusCode: 401 });
});
