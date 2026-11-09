/** @file Identidad con Mongo real: una consulta, snapshot coherente y revocación sin caché. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const {
  identityAuthorizationRepository,
} = require('../server/modules/identity/repositories/identity-authorization.repository');
const { identityService } = require('../server/modules/identity/services/identity.service');
const { readSnapshot }    = require('../server/adapters/mongodb/read-snapshot');

test(
  'identidad une cuenta, sesión y más de cien espacios en un único snapshot y revalida cada revocación',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : 60000,
  },
  /** @returns {Promise<void>} Modelos y políticas productivos en un replica set exclusivo de la prueba. */
  async () => {
    const mongo = await startIsolatedMongo({
      binary          : process.env.TEST_MONGOD_BINARY,
      mongoose,
      monitorCommands : true,
    });
    try {
      const models = {};
      for (const name of ['user', 'session', 'workspaces']) {
        models[name] = mongo.connection.model(
          'Identity' + name,
          require('../server/modules/' + name + '/models/' + name + '.model').schema.clone(),
        );
        await models[name].createCollection();
        await models[name].createIndexes();
      }
      const context   = {
        user        : { userCode: 'u' },
        sessionCode : 's',
        workspace   : 'w230',
      };
      const messaging = {
        /** @returns {Object} Contexto técnico sintético acreditado. */
        getContext : () => context,
      };
      const base      = {
        workspace    : 'allWorkspaces',
        userCreate   : 'u',
        userAssigned : '',
        erased       : false,
      };
      const assigned  = Array.from(
        { length: 231 },
        /** @param {*} unused Valor no utilizado. @param {number} index Posición. @returns {string} Identificador sintético único. */
        (unused, index) => 'w' + index,
      );
      const account   = {
        ...base,
        userCode   : 'u',
        userType   : 'internal',
        state      : 'active',
        validity   : Date.now() + 3600000,
        workspaces : [...assigned, 'only-user'],
        password   : 'private-account-canary',
      };
      const session   = {
        ...base,
        userCode        : 'u',
        sessionCode     : 's',
        active          : true,
        expiration      : Date.now() / 1000 + 3600,
        activeWorkspace : 'w230',
        workspaces      : [...assigned, 'only-session'],
        policies        : ['read'],
        token           : 'private-session-canary',
      };
      await models.user.collection.insertOne(account);
      await models.session.collection.insertOne(session);
      await models.workspaces.collection.insertMany(
        [...assigned, 'only-user', 'only-session'].map(
          /** @param {string} workspaceCode Código sintético. @returns {Object} Workspace con contrato estructural válido. */
          (workspaceCode) => ({
            ...base,
            workspaceCode,
          }),
        ),
      );
      const authorization = identityAuthorizationRepository({
        session   : models.session,
        user      : models.user,
        workspace : models.workspaces,
        messaging,
      });
      const service       = identityService({
        authorization,
        messaging,
      });
      const commands      = [];
      mongo.connection.getClient().on(
        'commandStarted',
        /** @param {Object} event Comando local de la prueba. @returns {void} Retiene sólo el comando y sus garantías, sin datos. */
        (event) =>
          commands.push({
            name        : event.commandName,
            snapshot    : event.command.readConcern?.level,
            transaction : event.command.autocommit === false,
          }),
      );
      const first = await service.current('service-platform');
      assert.equal(first.workspaces.length, 231);
      assert.equal(first.workspace, 'w230');
      assert.deepEqual(
        commands.map(
          /** @param {Object} command Metadatos. @returns {string} Nombre técnico. */
          (command) => command.name,
        ),
        ['aggregate'],
      );
      assert.equal(commands[0].snapshot, 'snapshot');
      const privateRow = await authorization.read({
        userCode    : 'u',
        sessionCode : 's',
        now         : Date.now(),
      });
      assert(!JSON.stringify(privateRow).includes('canary'));

      const snapshot = readSnapshot({
        mongoose,
        connection : mongo.connection,
      });
      commands.length = 0;
      await snapshot(
        /** @returns {Promise<void>} Revocar por otra conexión lógica no altera la instantánea ya iniciada. */
        async () => {
          assert.equal((await service.current('service-platform')).workspace, 'w230');
          await models.workspaces.collection.updateOne(
            { workspaceCode: 'w230' },
            { $set: { erased: true } },
          );
          assert.equal((await service.current('service-platform')).workspace, 'w230');
        },
      );
      const aggregates = commands.filter(
        /** @param {Object} command Metadatos. @returns {boolean} Lectura de identidad. */
        (command) => command.name === 'aggregate',
      );
      assert.equal(aggregates.length, 2);
      assert(
        aggregates.every(
          /** @param {Object} command Metadatos. @returns {boolean} Ambas lecturas heredan la transacción. */
          (command) => command.transaction,
        ),
      );
      await assert.rejects(service.current('service-platform'), { statusCode: 403 });
      await models.workspaces.collection.updateOne(
        { workspaceCode: 'w230' },
        { $set: { erased: false } },
      );

      for (const [model, filter, changes, expected] of [
        [models.user, { userCode: 'u' }, { state: 'blocked' }, 401],
        [models.user, { userCode: 'u' }, { validity: 1 }, 401],
        [models.user, { userCode: 'u' }, { erased: true }, 401],
        [models.user, { userCode: 'u' }, { userType: 'agent' }, 401],
        [models.user, { userCode: 'u' }, { workspaces: ['w0'] }, 403],
        [models.session, { sessionCode: 's' }, { active: false }, 401],
        [models.session, { sessionCode: 's' }, { expiration: 1 }, 401],
        [models.session, { sessionCode: 's' }, { activeWorkspace: 'w0' }, 401],
        [models.session, { sessionCode: 's' }, { workspaces: ['w0'] }, 403],
        [models.workspaces, { workspaceCode: 'w230' }, { userCreate: null }, 403],
      ]) {
        const original = await model.collection.findOne(filter);
        await model.collection.updateOne(filter, { $set: changes });
        await assert.rejects(service.current('service-platform'), { statusCode: expected });
        await model.collection.replaceOne(filter, original);
      }
      assert.equal((await service.current('service-platform')).workspaces.length, 231);
      await mongo.connection.close();
      await assert.rejects(service.current('service-platform'));
    } finally {
      await mongo.stop();
    }
  },
);
