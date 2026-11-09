/** @file MongoDB real: configuración atómica y página estable aunque otro proceso escriba entre filas y total. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const { readSnapshot }       = require('../server/adapters/mongodb/read-snapshot');
test(
  'Security conserva el snapshot entre filas y total y revierte configuración con su outbox',
  { skip: !process.env.TEST_MONGOD_BINARY },
  /** @returns {Promise<void>} Usa modelos y repositorios productivos dentro de una base temporal. */
  async () => {
    const database = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    try {
      const db         = database.connection;
      const snapshot   = readSnapshot({
        mongoose,
        connection : db,
      });
      let rejectOutbox = false;
      const messaging  = {
        /** @returns {Object} Contexto interno sintético. */
        getContext() {
          return {
            user      : { userCode: 'u' },
            workspace : 'w',
          };
        },
        /** @param {string} name Hecho. @param {Object} data Referencia mínima. @param {Object} options Sesión de negocio. @returns {Promise<void>} Inyecta fallo después de escribir para verificar rollback. */
        async publishEvent(name, data, options) {
          assert.ok(options.session.inTransaction());
          await db.db.collection('TEST_OUTBOX').insertOne(
            {
              name,
              data,
            },
            options,
          );
          if (rejectOutbox) throw new Error('OUTBOX_FAILED');
        },
      };
      await db.db.createCollection('TEST_OUTBOX');
      const settingModel = db.model(
        'SnapshotSettings',
        require('../server/modules/settings/models/settings.model').schema.clone(),
      );
      await settingModel.createCollection();
      const settings = require('../server/modules/settings/repositories/settings.repository')({
        model : settingModel,
        messaging,
      });
      const trusted  = require('../server/modules/settings/policies/settings.policy').trustedScopes
        .guest;
      await settings.create('session-setings', { multisession: false }, trusted);
      assert.equal((await settings.get('session-setings', trusted)).revision, 1);
      rejectOutbox = true;
      await assert.rejects(
        settings.update('session-setings', { multisession: true }, trusted),
        /OUTBOX_FAILED/,
      );
      assert.equal((await settings.get('session-setings', trusted)).data.multisession, false);
      assert.equal(await db.db.collection('TEST_OUTBOX').countDocuments(), 1);
      rejectOutbox = false;
      await Promise.all([
        settings.update('session-setings', { multisession: true }, trusted),
        settings.update('session-setings', { maximumFailedAttempts: 5 }, trusted),
      ]);
      assert.deepEqual((await settings.get('session-setings', trusted)).data, {
        multisession          : true,
        maximumFailedAttempts : 5,
      });
      assert.equal((await settings.get('session-setings', trusted)).revision, 3);
      await settings.update('session-setings', { maximumFailedAttempts: 6 }, trusted, 3);
      await assert.rejects(
        settings.update('session-setings', { maximumFailedAttempts: 8 }, trusted, 3),
        /** @param {Error} error Conflicto esperado. @returns {boolean} La escritura antigua no produce evento. */
        (error) => error.statusCode === 409 && error.message.includes('SETTINGS_REVISION_CONFLICT'),
      );
      assert.equal((await settings.get('session-setings', trusted)).data.maximumFailedAttempts, 6);
      assert.equal(await db.db.collection('TEST_OUTBOX').countDocuments(), 4);
      await settingModel.collection.insertOne({
        parameter    : 'user-setings',
        userCreate   : '',
        userAssigned : '',
        data         : { tokenNotificationExpiration: 60 },
        workspace    : 'allWorkspaces',
      });
      await settings.update('user-setings', { tokenNotificationExpiration: 120 }, trusted, 0);
      assert.equal((await settings.get('user-setings', trusted)).revision, 1);
      const facts = await db.db.collection('TEST_OUTBOX').find().toArray();
      for (const fact of facts) {
        assert.equal(fact.name, 'security.resource.changed');
        assert.deepEqual(Object.keys(fact.data).sort(), ['code', 'resource', 'revision']);
      }
      const beforeCount = Promise.withResolvers();
      const schema      = require('../server/modules/group/models/group.model').schema.clone();
      let writer;
      schema.pre(
        'countDocuments',
        /** @returns {Promise<void>} El escritor externo confirma después de leer filas y antes de contar. */
        async function concurrentWrite() {
          beforeCount.resolve();
          await writer;
        },
      );
      const model = db.model('SnapshotGroups', schema);
      await model.createCollection();
      const repository = require('../server/modules/group/repositories/group.repository')({
        model,
        messaging,
      });
      const scope      = require('../server/modules/group/policies/group.policy').trustedScopes.guest;
      const first      = {
        groupCode    : 'g1',
        name         : 'Primero',
        workspace    : 'w',
        userCreate   : 'u',
        userAssigned : '',
        erased       : false,
      };
      await repository.create(first, scope);
      writer = beforeCount.promise.then(
        /** @returns {Promise<Object>} Este escritor se inició fuera del contexto transaccional de lectura. */
        () =>
          repository.create(
            {
              ...first,
              groupCode : 'g2',
              name      : 'Segundo',
            },
            scope,
          ),
      );
      const result = await snapshot(
        /** @returns {Promise<Object>} Filas y total mediante el repositorio real. */
        () => repository.getList({}, { groupCode: 1 }, 0, 10, '', scope),
      );
      assert.equal(result.listItem.length, 1);
      assert.equal(result.totalCount, 1);
      assert.equal(await model.countDocuments(), 2);
    } finally {
      await database.stop();
    }
  },
);
