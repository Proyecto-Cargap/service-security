/** @file Caracterización de la frontera pública de usuarios y regresiones de confidencialidad con registros simples y Mongoose. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  userPresenter,
  userPagePresenter,
} = require('../server/modules/user/presenters/user.presenter');
const { applicationRecord }  = require('../server/adapters/persistence/application-record');
const userController         = require('../server/modules/user/controllers/user.controller');
const { userQueriesService } = require('../server/modules/user/services/user-queries.service');
const {
  userCredentialsService,
} = require('../server/modules/user/services/user-credentials.service');
const { ApplicationError } = require('../server/shared/application-error');

/**
 * Prepara un usuario con todos los campos privados históricos y un campo privado futuro.
 * @returns {Object} Registro que permite detectar fugas sin credenciales reales.
 */
function privateUser() {
  return {
    userCode                        : 'u',
    user                            : 'user@example.invalid',
    workspace                       : 'w',
    userCreate                      : '',
    userAssigned                    : '',
    groups                          : ['g'],
    workspaces                      : ['w'],
    state                           : 'active',
    validity                        : Date.now() + 60000,
    password                        : 'private-fixture',
    activationToken                 : 'private-fixture',
    sessionRevision                 : 8,
    deletionDate                    : 1,
    accessBlockReason               : 'private-fixture',
    credentialsChangedAt            : 3,
    passwordRecoveryHash            : 'private-fixture',
    passwordRecoveryExpiresAt       : 10,
    passwordRecoveryLastRequestedAt : 10,
    passwordRecoveryWindowStart     : 10,
    passwordRecoveryRequests        : 2,
    futurePrivateField              : 'private-fixture',
  };
}

/**
 * Verifica la ausencia de todos los metadatos privados y de estado técnico de persistencia.
 * @param {Object} value Representación pública que se inspecciona.
 * @returns {void} Falla si la representación contiene credenciales o campos internos.
 */
function assertPublic(value) {
  for (const key of [
    'password',
    'activationToken',
    'sessionRevision',
    'deletionDate',
    'accessBlockReason',
    'credentialsChangedAt',
    'passwordRecoveryHash',
    'passwordRecoveryExpiresAt',
    'passwordRecoveryLastRequestedAt',
    'passwordRecoveryWindowStart',
    'passwordRecoveryRequests',
    'futurePrivateField',
    '_doc',
  ])
    assert.equal(Object.hasOwn(value, key), false, key);
  assert.equal(JSON.stringify(value).includes('private-fixture'), false);
}

/**
 * Comprueba listas positivas, ausencia y copias sin depender de un serializador externo.
 * @returns {void} Finaliza al acreditar que no se muta ni se serializa el registro privado.
 */
function verifyPublicProjection() {
  const row    = privateUser();
  const result = userPresenter(row);
  assertPublic(result);
  assert.equal(result.userCode, 'u');
  result.groups.push('other');
  assert.deepEqual(row.groups, ['g']);
  assert.equal(userPresenter(null), null);
  assert.deepEqual(userPresenter({ userCode: 'partial' }), { userCode: 'partial' });
  const page = userPagePresenter({
    pagination : {
      total    : 1,
      page     : 1,
      perPage  : 20,
      internal : true,
    },
    items      : [
      {
        ...row,
        role : {
          roleCode : 'r',
          name     : 'Role',
        },
      },
    ],
  });
  assertPublic(page.items[0]);
  assert.deepEqual(page.items[0].role, {
    roleCode : 'r',
    name     : 'Role',
  });
  assert.deepEqual(page.pagination, {
    total   : 1,
    page    : 1,
    perPage : 20,
  });
}

/**
 * Compara documentos reales sin conexión y registros de aplicación con los mismos datos.
 * @returns {void} Finaliza al comprobar la separación entre datos internos y proyección pública.
 */
function verifyMongooseBoundary() {
  const UserModel = require('../server/modules/user/models/user.model');
  const document  = new UserModel(privateUser());
  const record    = applicationRecord(document);
  assert.equal(Object.getPrototypeOf(record), Object.prototype);
  assert.equal(typeof record._id, 'string');
  assert.equal(record.password, 'private-fixture');
  assert.equal(record.sessionRevision, 8);
  assert.equal(record.save, undefined);
  assert.equal(record.toObject, undefined);
  assert.equal(record.toJSON, undefined);
  assertPublic(userPresenter(record));
  assert.deepEqual(userPresenter(record), JSON.parse(JSON.stringify(document)));
  assert.notEqual(record.groups, document.groups);
  assert.equal(applicationRecord(null), null);
  const original = JSON.parse('{"__proto__":{"private":true},"nested":{"items":[1,2]}}');
  const copied   = applicationRecord(original);
  assert.equal(Object.getPrototypeOf(copied), Object.prototype);
  assert.equal(Object.hasOwn(copied, '__proto__'), true);
  assert.deepEqual(copied, original);
  assert.notEqual(copied.nested.items, original.nested.items);
}

/**
 * Conserva el sobre RPC de las operaciones existentes y aplica una misma página a todo emisor.
 * @returns {Promise<void>} Finaliza al comprobar todas las respuestas públicas de usuarios.
 */
async function verifyControllerProjection() {
  const row   = privateUser();
  const page  = {
    pagination : {
      total   : 1,
      page    : 1,
      perPage : 20,
    },
    items      : [row],
  };
  const calls = [];
  /**
   * Devuelve un registro interno que el controlador debe presentar explícitamente.
   * @returns {Promise<Object>} Registro privado para caracterizar la frontera.
   */
  async function single() {
    return row;
  }
  /**
   * Registra una consulta de página, sin colecciones especiales por consumidor.
   * @param {Object} data Solicitud original de paginación.
   * @returns {Promise<Object>} Una página con sus datos internos.
   */
  async function list(data) {
    calls.push(data);
    return page;
  }
  /**
   * Sustituye el caso de uso sin repositorios, firma, configuración ni conexiones.
   * @returns {Object} Capacidades mínimas ejercitadas por estos controladores.
   */
  function service() {
    return {
      create      : single,
      register    : single,
      getOne      : single,
      delete      : single,
      confirm     : single,
      getList     : list,
      getByPolicy : list,
    };
  }
  /**
   * Construye el mismo sobre de respuesta utilizado por el adaptador de mensajería.
   * @param {number} statusCode Estado público.
   * @param {*} data Contenido público ya proyectado.
   * @returns {Object} Sobre que permite inspeccionar la frontera sin transporte.
   */
  function successResponse(statusCode, data) {
    return {
      statusCode,
      data,
    };
  }
  const controller = userController({
    services  : { user: service },
    messaging : { successResponse },
  });
  for (const action of ['create', 'register', 'getOne', 'getOneByemail', 'delete', 'confirm']) {
    const response = await controller[action]({ data: { code: 'u' } });
    assert.equal(response.statusCode, ['create', 'register'].includes(action) ? 201 : 200);
    assertPublic(response.data);
    assert.equal(response.data.userCode, 'u');
  }
  assertPublic((await controller.getList({ data: {} })).data.items[0]);
  for (const originService of ['service-platform', 'service-directory', 'service-intelligence']) {
    const response = await controller.getByPolicy({
      originService,
      data : { identifier: 'read' },
    });
    assertPublic(response.data.items[0]);
    assert.deepEqual(response.data.pagination, page.pagination);
  }
  assert.deepEqual(calls, [
    {},
    { identifier: 'read' },
    { identifier: 'read' },
    { identifier: 'read' },
  ]);
}

/**
 * Verifica que una consulta usa un repositorio mínimo de registros simples sin acceder a _doc.
 * @returns {Promise<void>} Finaliza tras comprobar paginación, enriquecimiento y confidencialidad.
 */
async function verifyPlainList() {
  const row       = privateUser();
  const userState = {};
  /** @returns {Object} Contexto de la consulta ya autorizado por el puerto de política. */
  function getContext() {
    return {};
  }
  /** @returns {Object} Restricción de acceso de la capacidad sustituida. */
  function authorize() {
    return {};
  }
  /** @returns {Object} Paginación interna desde cero. */
  function getPublicPagination() {
    return {
      page    : 0,
      perPage : 20,
    };
  }
  /** @returns {Object} Orden estable de la página. */
  function getSortQuery() {
    return { userCode: 1 };
  }
  /** @returns {Promise<Object>} Página de registros sin métodos de persistencia. */
  async function getList() {
    return {
      listItem   : [row],
      totalCount : 1,
    };
  }
  /** @returns {Promise<null>} Ausencia del rol opcional; no es ausencia del usuario. */
  async function cachedEntity() {
    return null;
  }
  const service = userQueriesService({
    ApplicationError,
    userState,
    userPolicy     : { authorize },
    messaging      : { getContext },
    userRepository : { getList },
    utilities      : {
      getPublicPagination,
      getSortQuery,
      cachedEntity,
    },
  });
  const result  = await service.getList({});
  assert.equal(result.items[0].userCode, 'u');
  assert.equal(result.items[0].role, null);
  assertPublic(result.items[0]);
  assert.equal(row.password, 'private-fixture');
}

/**
 * Conserva el bloqueo por intentos fallidos sin publicar datos privados del repositorio simple.
 * @returns {Promise<void>} Finaliza tras verificar el error de autenticación y el aviso público.
 */
async function verifyFailedAccessNotification() {
  const row           = privateUser();
  const notifications = [];
  let updates         = 0;
  /** @returns {Promise<boolean>} Resultado de comparación incorrecto. */
  async function compare() {
    return false;
  }
  /** @returns {Promise<Object>} Límite que provoca el bloqueo en este intento. */
  async function get() {
    return { data: { maximumFailedAttempts: 1 } };
  }
  /** @returns {Promise<Object>} Registro persistido que conserva los datos privados internos. */
  async function update() {
    updates++;
    return {
      ...row,
      state : 'blocked',
    };
  }
  /**
   * Captura la notificación en memoria sin enviar mensajes externos.
   * @param {string} service Destinatario técnico.
   * @param {string} action Acción publicada.
   * @param {Object} payload Datos públicos.
   * @returns {Promise<void>} Finaliza al registrar la publicación.
   */
  async function sendCommand(service, action, payload) {
    notifications.push({
      service,
      action,
      payload,
    });
  }
  /** @param {Error} error Error que debe conservar la semántica de credenciales incorrectas.
   * @returns {boolean} Coincidencia con el estado público esperado.
   */
  function incorrectPassword(error) {
    return error.statusCode === 406;
  }
  const service = userCredentialsService({
    ApplicationError,
    bcrypt             : { compare },
    settingsRepository : { get },
    settingsScopes     : {},
    userRepository     : { update },
    userScopes         : {},
    userState          : { document: row },
    messaging          : { sendCommand },
    id                 : 'N0001',
    controller         : 'C001',
  });
  await assert.rejects(service.authentication('incorrect'), incorrectPassword);
  assert.equal(updates, 1);
  assert.equal(notifications.length, 0);
}

test(
  'la proyección pública usa campos explícitos y no comparte las colecciones privadas',
  verifyPublicProjection,
);
test(
  'documentos Mongoose y registros simples conservan la misma representación pública',
  verifyMongooseBoundary,
);
test(
  'los controladores proyectan registros y mantienen paginación independiente del consumidor',
  verifyControllerProjection,
);
test('el listado acepta colaboradores mínimos con registros simples', verifyPlainList);
test(
  'el bloqueo persiste mediante el repositorio sin difundir datos por canales antiguos',
  verifyFailedAccessNotification,
);
