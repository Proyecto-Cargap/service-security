/** @file Integración local real de RPC, DTO, permisos, presentación, paginación y repositorio de usuarios con MongoDB y RabbitMQ aislados. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const { randomUUID }         = require('node:crypto');
const { startIsolatedAmqp }  = require('./helpers/isolated-amqp.cjs');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');

/**
 * Recorre el límite RPC real de dos acciones de lectura y del catálogo, sin conexiones externas ni consultas por consumidor.
 * @returns {Promise<void>} Finaliza tras verificar respuestas públicas y cierre de todos los recursos propios.
 */
async function verifyMessagingContracts() {
  const mongoose               = require('mongoose');
  const { MessagingRuntime }   = require('../server/library/messaging/runtime');
  const { createFacade }       = require('../server/library/messaging/facade');
  const { registerCatalog }    = require('../server/library/messaging/catalog');
  const health                 = require('../server/library/messaging/health');
  const contracts              = require('../server/contracts');
  const { userQueriesService } = require('../server/modules/user/services/user-queries.service');
  const { ApplicationError }   = require('../server/shared/application-error');
  const utilities              = require('../server/shared/general');
  const logger                 = {
    /** @returns {void} Omite registros internos y credenciales de procesos efímeros. */
    error() {},
  };
  let database;
  let broker;
  const runtimes = [];
  try {
    database = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    broker = await startIsolatedAmqp({
      rabbitmqServer : process.env.TEST_RABBITMQ_SERVER_BINARY,
      epmd           : process.env.TEST_EPMD_BINARY,
    });
    const connection = database.connection;
    for (const [collection, indexes] of Object.entries(
      require('../server/library/messaging/indexes.json'),
    ))
      for (const { key, ...options } of indexes)
        await connection.db.collection(collection).createIndex(key, options);
    const namespace = `solid-${randomUUID()}`;
    /** @param {string} service Identidad del proceso de prueba.
     * @returns {Object} Runtime que utiliza exclusivamente broker y persistencia temporales.
     */
    function createRuntime(service) {
      const runtime = new MessagingRuntime({
        service,
        namespace,
        url    : broker.url,
        logger,
        config : {
          startTimeoutMs    : 10000,
          rpcTimeoutMs      : 5000,
          shutdownTimeoutMs : 5000,
        },
      });
      runtimes.push(runtime);
      return runtime;
    }
    const securityRuntime = createRuntime('service-security');
    const callerRuntime   = createRuntime('service-platform');
    const messaging       = createFacade(securityRuntime);
    const caller          = contracts.client(createFacade(callerRuntime));
    const schema          = require('../server/modules/user/models/user.model').schema;
    const model           = connection.model('RpcSecurityUser', schema);
    await model.createCollection();
    for (let index = 0; index < 231; index++)
      await model.collection.insertOne({
        userCode           : `u${String(index).padStart(3, '0')}`,
        user               : `u${index}@example.invalid`,
        workspace          : 'w',
        userCreate         : 'admin',
        userAssigned       : '',
        roleCode           : '',
        erased             : false,
        password           : 'private-fixture',
        activationToken    : 'private-fixture',
        futurePrivateField : 'private-fixture',
      });
    const userRepository = require('../server/modules/user/repositories/user.repository')({
      model,
      messaging,
    });
    /** @returns {Object} Casos de lectura construidos con sus colaboradores mínimos y repositorio real. */
    function userService() {
      return userQueriesService({
        ApplicationError,
        id         : 'N0001',
        controller : 'C001',
        logger,
        messaging,
        utilities,
        userRepository,
        userState  : {},
        userPolicy : require('../server/modules/user/policies/user.policy'),
      });
    }
    const controller = require('../server/modules/user/controllers/user.controller')({
      messaging,
      services : { user: userService },
    });
    registerCatalog(messaging, {
      connection,
      service : 'service-security',
      health,
      catalog : contracts.catalog([
        {
          name    : 'user-get-one',
          handler : controller.getOne,
        },
        {
          name    : 'user-get-list',
          handler : controller.getList,
        },
      ]),
    });
    await securityRuntime.start({ connection });
    await callerRuntime.start({ connection });
    assert.equal(securityRuntime.state, 'ready');
    assert.equal(callerRuntime.state, 'ready');
    const context  = {
      user          : { userCode: 'admin' },
      workspace     : 'w',
      policies      : ['security.user.view.global'],
      idTransaction : 'rpc-fixture',
    };
    const response = await caller.request(
      'service-security',
      'userGetOne',
      { code: 'u000' },
      { context },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.data.userCode, 'u000');
    assert.equal(typeof response.data._id, 'string');
    assert.equal(JSON.stringify(response).includes('private-fixture'), false);
    /** @param {Object} page Paginación pública uniforme.
     * @returns {Promise<Object>} Página RPC validada por ambos DTO y el repositorio real.
     */
    async function readPage(page) {
      const result = await caller.request('service-security', 'user-get-list', page, { context });
      assert.equal(result.statusCode, 200);
      return result.data;
    }
    const all = await utilities.collectPages(readPage);
    assert.equal(all.items.length, 231);
    assert.equal(all.items[230].userCode, 'u230');
    assert.equal(JSON.stringify(all).includes('private-fixture'), false);
    const denied = await caller.request(
      'service-security',
      'user-get-one',
      { code: 'u000' },
      {
        context : {
          ...context,
          policies : [],
        },
      },
    );
    assert.equal(denied.statusCode, 404);
    const invalid = await caller.request(
      'service-security',
      'user-get-one',
      {
        code               : 'u000',
        consumerProjection : ['password'],
      },
      { context },
    );
    assert.equal(invalid.statusCode, 400);
    const discovery = await caller.request('service-security', 'service-contracts-get', {});
    assert.equal(discovery.statusCode, 200);
    assert.equal(discovery.data.service, 'service-security');
    assert.equal(
      discovery.data.endpoints.length,
      require('../server/contracts/service.json').endpoints.length,
    );
    const ready = contracts.actionDtos.health.output(
      await caller.request('service-security', 'health', {}),
    );
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.data.database, 'ready');
    assert.equal(ready.data.messaging, 'ready');
    await caller.close();
    await messaging.close();
    assert.equal(callerRuntime.state, 'closed');
    assert.equal(securityRuntime.state, 'closed');
    await assert.rejects(caller.request('service-security', 'health', {}), {
      code : 'NOT_AVAILABLE',
    });
  } finally {
    for (const runtime of runtimes.reverse()) await runtime.close();
    try {
      await broker?.stop();
    } finally {
      await database?.stop();
    }
  }
}

test(
  'RPC real conserva DTO, permisos, páginas, privacidad, catálogo y cierre en infraestructura aislada',
  {
    skip    :
      !process.env.TEST_MONGOD_BINARY ||
      !process.env.TEST_RABBITMQ_SERVER_BINARY ||
      !process.env.TEST_EPMD_BINARY,
    timeout : 60000,
  },
  verifyMessagingContracts,
);
