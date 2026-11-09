/** @file MongoDB real: cada cambio de acceso comparte transacción y revisión con su referencia durable. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');

test(
  'Security confirma acceso y outbox atómicamente, incluso con escritores concurrentes',
  { skip: !process.env.TEST_MONGOD_BINARY },
  /** @returns {Promise<void>} Verifica rollback, bajas múltiples y ausencia de eventos de heartbeat. */
  async () => {
    const isolated = await startIsolatedMongo({
      binary   : process.env.TEST_MONGOD_BINARY,
      mongoose : require('mongoose'),
    });
    try {
      const db        = isolated.connection.db;
      let rejected    = false;
      const messaging = {
        /** @returns {Object} Autoridad interna usada por políticas reales. */
        getContext() {
          return {
            user          : { userCode: 'admin' },
            workspace     : 'w',
            idTransaction : 'test',
          };
        },
        /** @param {string} name Evento. @param {Object} data Referencia. @param {Object} options Sesión MongoDB. @returns {Promise<void>} Outbox observable con fallo inducido después de insertar. */
        async publishEvent(name, data, options) {
          assert.equal(name, 'security.access.changed');
          assert.equal(options.session.inTransaction(), true);
          assert.equal(JSON.stringify(data).includes('PRIVATE'), false);
          assert.deepEqual(
            Object.keys(data).sort(),
            data.resource === 'session'
              ? ['code', 'resource', 'revision', 'userCode']
              : ['code', 'resource', 'revision'],
          );
          await db.collection('TEST_OUTBOX').insertOne(
            {
              name,
              data,
            },
            options,
          );
          if (rejected) throw new Error('OUTBOX_FAILED');
        },
      };
      const fixtures  = {
        user       : {
          codeField : 'userCode',
          data      : {
            user     : 'u@example.invalid',
            password : 'PRIVATE',
            state    : 'active',
            validity : Date.now() + 3600000,
          },
          mutable   : 'state',
          value     : 'blocked',
        },
        group      : {
          codeField : 'groupCode',
          data      : {
            name     : 'Grupo',
            policies : [],
          },
          mutable   : 'name',
          value     : 'Nuevo',
        },
        policy     : {
          codeField : 'policyCode',
          data      : {
            identifier  : 'fixture.read',
            description : 'Política',
            service     : 'fixture',
            section     : 'fixture',
          },
          mutable   : 'description',
          value     : 'Nueva',
        },
        workspaces : {
          codeField : 'workspaceCode',
          data      : { name: 'Espacio' },
          mutable   : 'name',
          value     : 'Nuevo',
        },
        session    : {
          codeField : 'sessionCode',
          data      : {
            userCode        : 'u',
            token           : 'PRIVATE-session',
            activeWorkspace : 'w',
            expiration      : Date.now() / 1000 + 600,
            active          : true,
          },
          mutable   : 'active',
          value     : false,
        },
      };
      for (const [domain, fixture] of Object.entries(fixtures)) {
        const model = isolated.connection.model(
          `Access${domain}`,
          require(`../server/modules/${domain}/models/${domain}.model`).schema.clone(),
          `ACCESS_${domain}`,
        );
        await model.createCollection();
        const repository = require(`../server/modules/${domain}/repositories/${domain}.repository`)(
          {
            model,
            messaging,
          },
        );
        const scope      = require(`../server/modules/${domain}/policies/${domain}.policy`).trustedScopes
          .guest;
        const filter     = { [fixture.codeField]: domain };
        const created    = await repository.create(
          {
            ...fixture.data,
            ...filter,
            workspace    : 'w',
            userCreate   : '',
            userAssigned : '',
          },
          scope,
        );
        assert.equal(created.revision, 1);
        const baseline = await db.collection('TEST_OUTBOX').countDocuments({});
        rejected = true;
        await assert.rejects(
          repository.update(filter, { $set: { [fixture.mutable]: fixture.value } }, scope),
          /OUTBOX_FAILED/,
        );
        assert.equal((await repository.getOne(filter, scope)).revision, 1);
        assert.equal(await db.collection('TEST_OUTBOX').countDocuments({}), baseline);
        rejected = false;
        await Promise.all([
          repository.update(filter, { $set: { [fixture.mutable]: fixture.value } }, scope),
          repository.update(filter, { $set: { [fixture.mutable]: fixture.value } }, scope),
        ]);
        assert.equal((await repository.getOne(filter, scope)).revision, 3);
        const events = await db
          .collection('TEST_OUTBOX')
          .find({ 'data.code': domain })
          .sort({ 'data.revision': 1 })
          .toArray();
        assert.deepEqual(
          events.map(
            /** @param {Object} event Hecho confirmado. @returns {number} Revisión atómica. */
            (event) => event.data.revision,
          ),
          [1, 2, 3],
        );
        if (domain === 'session') {
          await repository.refreshAccess(created._id, Date.now(), 0);
          assert.equal(await db.collection('TEST_OUTBOX').countDocuments({}), baseline + 2);
        }
        rejected = true;
        await assert.rejects(repository.deleteMany(filter, true, scope), /OUTBOX_FAILED/);
        assert.equal((await repository.getOne(filter, scope)).erased, false);
        rejected = false;
        assert.equal((await repository.deleteMany(filter, true, scope)).deletedCount, 1);
        assert.equal((await repository.getOne(filter, scope)).revision, 4);
        assert.equal((await repository.deleteMany(filter, false, scope)).deletedCount, 1);
        assert.equal(await repository.getOne(filter, scope), null);
      }
    } finally {
      await isolated.stop();
    }
  },
);
