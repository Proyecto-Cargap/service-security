/** @file Regresión de apertura y renovación: JWT público, revisión de credenciales y avisos sin tokens con registros simples. */
'use strict';
const test              = require('node:test');
const assert            = require('node:assert/strict');
const jwt               = require('jsonwebtoken');
const createSession     = require('../server/modules/session/services/session.service');
const { tokenContexts } = require('../server/adapters/security/token-contexts');
const { actionDtos }    = require('../server/contracts');

/**
 * Compone una sesión con colaboradores mínimos en memoria, sin modelos, conexiones ni entorno.
 * @returns {Object} Caso de uso, usuario privado, efectos y lectura de escrituras capturadas.
 */
function fixture() {
  const user      = {
    userCode             : 'u',
    roleCode             : 'r',
    contactCode          : 'c',
    user                 : 'user@example.invalid',
    userType             : 'internal',
    groups               : ['g'],
    workspaces           : ['w'],
    state                : 'active',
    erased               : false,
    validity             : Date.now() + 60000,
    password             : 'private-fixture',
    activationToken      : 'private-fixture',
    passwordRecoveryHash : 'private-fixture',
    credentialsChangedAt : 9,
    sessionRevision      : 3,
  };
  const workspace = {
    workspaceCode  : 'w',
    name           : 'Workspace',
    pictureCleanup : ['private-fixture'],
  };
  const effects   = [];
  let record;
  let writes           = 0;
  let settingsReads    = 0;
  let policyIdentifier = 'fixture.read';
  /** @returns {Object} Contexto autenticado suministrado por el transporte. */
  function getContext() {
    return {
      idTransaction : 'fixture',
      workspace     : 'w',
    };
  }
  /** @returns {Promise<Object>} Identidad privada utilizada únicamente por la autenticación interna. */
  async function getUser() {
    return user;
  }
  /** @returns {Promise<boolean>} Autenticación acreditada por el colaborador de credenciales. */
  async function authentication() {
    return true;
  }
  /** @returns {Object} Capacidades mínimas de usuario que requiere la sesión. */
  function users() {
    return {
      getOne : getUser,
      authentication,
    };
  }
  /**
   * Construye una página completa respetando el tamaño solicitado por collectPages.
   * @param {Object} query Página y tamaño de la consulta.
   * @param {Object[]} items Registros autorizados del colaborador.
   * @returns {Object} Página estable y completa.
   */
  function page(query, items) {
    return {
      pagination : {
        total   : items.length,
        page    : query.page,
        perPage : query.perPage,
      },
      items,
    };
  }
  /** @param {Object} query Filtros ya autorizados del workspace.
   * @returns {Promise<Object>} Página de membresías actuales.
   */
  async function listWorkspaces(query) {
    return page(query, [workspace]);
  }
  /** @returns {Promise<Object>} Workspace actual autorizado por su colaborador. */
  async function getWorkspace() {
    return workspace;
  }
  /** @returns {Object} Lecturas mínimas de workspaces. */
  function workspaces() {
    return {
      getList : listWorkspaces,
      getOne  : getWorkspace,
    };
  }
  /** @param {Object} query Filtros y paginación del grupo.
   * @returns {Promise<Object>} Una membresía con su política actual.
   */
  async function listGroups(query) {
    return page(query, [{ policies: ['p'] }]);
  }
  /** @returns {Object} Capacidad mínima de lectura de grupos. */
  function groups() {
    return { getList: listGroups };
  }
  /** @param {Object} query Filtros y paginación de políticas.
   * @returns {Promise<Object>} Una política activa acreditada.
   */
  async function listPolicies(query) {
    return page(query, [
      {
        identifier : policyIdentifier,
        active     : true,
      },
    ]);
  }
  /** @returns {Object} Capacidad mínima de lectura de políticas. */
  function policies() {
    return { getList: listPolicies };
  }
  /** @returns {Promise<Object>} Configuración explícita sin valores predeterminados internos. */
  async function settings() {
    settingsReads++;
    return {
      data : {
        multisession           : true,
        tokenSessionExpiration : 3600,
      },
    };
  }
  /** @returns {Promise<Object>} Información de Platform ya validada por su adaptador. */
  async function information() {
    return {
      publicUrl : 'https://example.invalid',
      title     : 'Fixture',
      logos     : { email: 'logo' },
      theme     : { primary: { 900: '#000000' } },
    };
  }
  /** @returns {Promise<string>} Código de sesión generado por el colaborador contador. */
  async function getObjectCode() {
    return 'session-fixture';
  }
  /** @returns {Promise<void>} Reserva de emisión coordinada por la transacción del usuario. */
  async function lockForSession() {
    effects.push('lock');
  }
  /** @param {Object} input Registro validado por el caso de uso.
   * @returns {Promise<Object>} Registro simple de sesión, conservando el token sólo internamente.
   */
  async function create(input) {
    writes++;
    record = {
      ...input,
      _id    : 'row',
      active : true,
    };
    return { ...record };
  }
  /** @param {Object} query Credencial y cuenta. @returns {Promise<Object|null>} Registro sólo para la credencial vigente. */
  async function getOne(query) {
    return record &&
      (!query.token || query.token === record.token) &&
      (!query.userCode || query.userCode === record.userCode)
      ? { ...record }
      : null;
  }
  /** @param {Object} input Registro de sesión con los cambios autorizados.
   * @returns {Promise<Object>} Copia persistida sin métodos de modelo.
   */
  async function updateItem(input) {
    writes++;
    record = { ...input };
    return { ...record };
  }
  /** @param {Function} work Trabajo que comparte el marcador transaccional.
   * @returns {Promise<*>} Resultado del trabajo sin abrir una conexión real.
   */
  async function transaction(work) {
    return work({ fixture: true });
  }
  /**
   * Resuelve únicamente el perfil canónico que requiere el flujo.
   * @param {string} service Servicio destinatario.
   * @param {string} action Acción pública.
   * @returns {Promise<Object>} Perfil del contacto acreditado.
   */
  async function request(service, action) {
    assert.equal(service, 'service-directory');
    assert.equal(action, 'contact-profile-get-one');
    return {
      statusCode : 200,
      data       : {
        name    : {
          firstName     : 'Name',
          preferredName : 'Nombre privado',
        },
        picture : '',
      },
    };
  }
  /**
   * Registra efectos sin enviar mensajes externos.
   * @param {string} service Destinatario técnico.
   * @param {string} action Acción publicada.
   * @param {Object} data Contenido capturado para verificar su contrato.
   * @returns {Promise<void>} Finaliza al registrar el efecto.
   */
  async function sendCommand(service, action, data) {
    effects.push({
      service,
      action,
      data,
    });
  }
  /** @param {Object} value Error técnico que impediría terminar el caso esperado.
   * @returns {never} Falla la prueba ante un error inesperado.
   */
  function error(value) {
    assert.fail(JSON.stringify(value));
  }
  const service = createSession({
    jwt,
    tokenSecret         : 'fixture-only',
    tokenContexts       : tokenContexts({
      PLATFORM_ID : 'fixture',
      ENV_NAME    : 'test',
    }),
    messaging           : {
      getContext,
      transaction,
      request,
      sendCommand,
    },
    counter             : { getObjectCode },
    settings            : { get: settings },
    platformInformation : { read: information },
    logger              : { error },
    services            : {
      user   : users,
      workspaces,
      group  : groups,
      policy : policies,
    },
    repositories        : {
      user    : { lockForSession },
      session : {
        create,
        getOne,
        updateItem,
      },
    },
  });
  /** @returns {number} Cantidad de escrituras para acreditar que una denegación no produce efectos. */
  function countWrites() {
    return writes;
  }
  return {
    service,
    user,
    effects,
    countWrites,
    /** @returns {number} Lecturas de configuración de renovación. */
    countSettingsReads() {
      return settingsReads;
    },
    /** @param {Object} changes Cambios canónicos para probar una revocación. @returns {void} Modifica sólo el registro del fixture. */
    changeSession(changes) {
      Object.assign(record, changes);
    },
    /** @param {string} identifier Política vigente del productor. @returns {void} Cambia el acceso sin reemitir la credencial. */
    changePolicy(identifier) {
      policyIdentifier = identifier;
    },
  };
}

/**
 * Comprueba que abrir y renovar no expone campos privados al dejar de usar documentos Mongoose.
 * @returns {Promise<void>} Finaliza tras comprobar ambos tokens y los avisos administrativos.
 */
async function verifyAuthorization() {
  const { service, user, effects, countWrites } = fixture();
  const created                                 = await service.create({
    user          : user.user,
    password      : 'verified-by-port',
    workspaceCode : 'w',
  });
  const renewed                                 = await service.renovate({ code: created.authorization });
  assert.equal(
    actionDtos['session-create'].output({
      statusCode : 201,
      data       : created,
    }).data,
    created,
  );
  assert.equal(
    actionDtos['session-renovate'].output({
      statusCode : 201,
      data       : renewed,
    }).data,
    renewed,
  );
  for (const result of [created, renewed]) {
    assert.equal(result.user.name.preferredName, 'Nombre privado');
    const claims = jwt.verify(result.authorization, 'fixture-only');
    assert.equal(claims.user.userCode, 'u');
    assert.equal(claims.credentialsChangedAt, 9);
    assert.equal(claims.iss, 'urn:xidden:fixture:test:security');
    assert.equal(claims.aud, 'urn:xidden:fixture:test:session');
    assert.equal(JSON.stringify(claims.user).includes('private-fixture'), false);
    assert.equal(JSON.stringify(claims.user).includes('Nombre privado'), false);
    for (const field of [
      'password',
      'activationToken',
      'passwordRecoveryHash',
      'credentialsChangedAt',
      'sessionRevision',
    ])
      assert.equal(Object.hasOwn(claims.user, field), false, field);
    assert.equal(JSON.stringify(result.user).includes('private-fixture'), false);
  }
  assert.equal(Object.hasOwn(user, 'preferredName'), false);
  for (const effect of effects) {
    assert.equal(JSON.stringify(effect).includes('Nombre privado'), false);
    if (effect.service !== 'service-platform') continue;
    assert.equal(JSON.stringify(effect.data).includes('private-fixture'), false);
    assert.equal(JSON.stringify(effect.data).includes('"token"'), false);
  }
  assert.equal(countWrites(), 2);
  user.credentialsChangedAt++;
  /** @param {Error} error Error de credenciales revocadas.
   * @returns {boolean} Conserva el rechazo público de la sesión.
   */
  function invalidSession(error) {
    return error.statusCode === 401 && error.descriptionCode === 'INVALID_SESSION';
  }
  await assert.rejects(service.renovate({ code: renewed.authorization }), invalidSession);
  assert.equal(countWrites(), 2);
}

test(
  'apertura y renovación firman usuarios públicos y conservan la revocación de credenciales',
  verifyAuthorization,
);

test('restaurar valida el acceso vigente sin rotar, extender ni escribir la sesión', /** @returns {Promise<void>} Varias pestañas conservan la misma credencial y reciben las políticas actuales. */ async () => {
  const f             = fixture();
  const created       = await f.service.create({
    user          : f.user.user,
    password      : 'fixture',
    workspaceCode : 'w',
  });
  const writes        = f.countWrites();
  const settingsReads = f.countSettingsReads();
  const effects       = f.effects.length;
  f.changePolicy('fixture.updated');
  for (let tab = 0; tab < 3; tab++) {
    const restored = await f.service.restore({ code: created.authorization });
    assert.equal(restored.authorization, created.authorization);
    assert.equal(restored.expiration, created.expiration);
    assert.equal(restored.sessionCode, created.sessionCode);
    assert.deepEqual(restored.policies, ['fixture.updated']);
    assert.equal(
      actionDtos['session-restore'].output({
        statusCode : 200,
        data       : restored,
      }).data,
      restored,
    );
  }
  assert.equal(f.countWrites(), writes);
  assert.equal(f.countSettingsReads(), settingsReads);
  assert.equal(f.effects.length, effects);
  f.user.credentialsChangedAt++;
  await assert.rejects(f.service.restore({ code: created.authorization }), { statusCode: 401 });
  assert.equal(f.countWrites(), writes);
});

test('restaurar rechaza revocación, expiración, membresías retiradas y credenciales sustituidas', /** @returns {Promise<void>} La restauración no devuelve acceso ni modifica el estado en ninguna denegación. */ async () => {
  for (const changes of [
    { active: false },
    { expiration: 1 },
    { workspaces: [] },
    { token: 'replaced' },
  ]) {
    const f       = fixture();
    const created = await f.service.create({
      user          : f.user.user,
      password      : 'fixture',
      workspaceCode : 'w',
    });
    f.changeSession(changes);
    const writes = f.countWrites();
    await assert.rejects(f.service.restore({ code: created.authorization }), { statusCode: 401 });
    assert.equal(f.countWrites(), writes);
  }
});

test('sólo Gateway puede solicitar la restauración y su DTO no admite selectores', /** @returns {Promise<void>} Valida origen e impide ampliar el contrato con un usuario o workspace elegido por el cliente. */ async () => {
  let calls        = 0;
  const controller = require('../server/modules/session/controllers/session.controller')({
    messaging : {
      /** @param {number} statusCode Estado. @param {Object} data Datos. @returns {Object} Sobre de prueba. */ successResponse(
        statusCode,
        data,
      ) {
        return {
          statusCode,
          data,
        };
      },
    },
    services  : {
      /** @returns {Object} Caso de uso simulado. */ session() {
        return {
          /** @param {Object} input Credencial. @returns {Promise<Object>} Resultado técnico sin credenciales. */ async restore(
            input,
          ) {
            calls++;
            assert.deepEqual(input, { code: 'fixture' });
            return { restored: true };
          },
        };
      },
    },
  });
  await assert.rejects(
    controller.restore({
      originService : 'service-platform',
      data          : { code: 'fixture' },
    }),
    { statusCode: 403 },
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await controller.restore({
        originService : 'service-apigateway',
        data          : { code: 'fixture' },
      })
    ).statusCode,
    200,
  );
  assert.equal(calls, 1);
  assert.throws(
    /** @returns {Object} Entrada prohibida. */ () =>
      actionDtos['session-restore'].input({
        code     : 'fixture',
        userCode : 'spoof',
      }),
  );
});
