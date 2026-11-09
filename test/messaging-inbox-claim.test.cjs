/** @file Acredita adquisición atómica sin lectura previa, duplicados, incertidumbre y transacciones MongoDB reales. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { MongoStore }         = require('../server/library/messaging/store');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');

/** @param {string} messageId Clave sintética. @returns {Object} Entrega nueva sin contenido productivo. */
function message(messageId) {
  return {
    handler    : 'request:read@1',
    messageId,
    wire       : '{}',
    execution  : 'nonTransactional',
    deadlineAt : Date.now() + 60000,
  };
}

test('un fallo incierto de inserción se propaga sin lectura ni segundo intento', /** @returns {Promise<void>} Evita confundir indisponibilidad con duplicado. */ async () => {
  const store = new MongoStore({
    connection : {},
    namespace  : 'isolated',
    service    : 'test',
  });
  store.ready = true;
  let inserts = 0,
    reads     = 0;
  const failure = Object.assign(new Error('synthetic unavailable'), { code: 91 });
  store.inbox = {
    /** @returns {Promise<never>} Simula confirmación fallida; no acredita si la escritura ocurrió. */
    async insertOne() {
      inserts++;
      throw failure;
    },
    /** @returns {Promise<null>} Una lectura posterior sería un reintento implícito indebido. */
    async findOne() {
      reads++;
      return null;
    },
  };
  await assert.rejects(store.claimInbox(message('uncertain')), failure);
  assert.equal(inserts, 1);
  assert.equal(reads, 0);
  failure.code = 11000;
  await assert.rejects(store.claimInbox(message('missing-duplicate')), failure);
  assert.equal(inserts, 2);
  assert.equal(reads, 1);
});

test(
  'Mongo real adquiere con un comando y conserva deduplicación, arrendamientos y rollback',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : 30000,
  },
  /** @returns {Promise<void>} Comprueba garantías sobre índices y transacciones reales aisladas. */ async () => {
    const database = await startIsolatedMongo({
      binary          : process.env.TEST_MONGOD_BINARY,
      mongoose,
      monitorCommands : true,
    });
    try {
      const connection = database.connection;
      for (const [name, indexes] of Object.entries(
        require('../server/library/messaging/indexes.json'),
      ))
        for (const { key, ...options } of indexes)
          await connection.db.collection(name).createIndex(key, options);
      const store    = await new MongoStore({
        connection,
        namespace : 'isolated',
        service   : 'test',
      }).initialize();
      const commands = [];
      /** @param {Object} event Metadato local. @returns {void} Conserva sólo el nombre técnico del comando. */
      function count(event) {
        commands.push(event.commandName);
      }
      connection.getClient().on('commandStarted', count);
      const first = await store.claimInbox(message('new'));
      connection.getClient().off('commandStarted', count);
      assert.deepEqual(commands, ['insert']);
      assert.equal(first.status, 'claimed');
      assert.equal((await store.claimInbox(message('new'))).status, 'busy');
      assert.equal(
        await store.completeInbox({
          id         : first.row.id,
          token      : first.row.token,
          resultWire : '{"ok":true}',
        }),
        true,
      );
      const completed = await store.claimInbox(message('new'));
      assert.equal(completed.status, 'completed');
      assert.equal(completed.row.resultWire, '{"ok":true}');
      const concurrent = await Promise.all(
        Array.from(
          { length: 20 },
          /** @returns {Promise<Object>} Compite por la misma clave sin sesión compartida. */ () =>
            store.claimInbox(message('concurrent')),
        ),
      );
      assert.equal(
        concurrent.filter(
          /** @param {Object} row Resultado. @returns {boolean} Sólo un propietario. */ (row) =>
            row.status === 'claimed',
        ).length,
        1,
      );
      assert.equal(
        concurrent.filter(
          /** @param {Object} row Resultado. @returns {boolean} Las otras entregas esperan. */ (
            row,
          ) => row.status === 'busy',
        ).length,
        19,
      );
      assert.equal(await store.inbox.countDocuments(store.scoped({ messageId: 'concurrent' })), 1);
      for (const status of ['failed', 'uncertain', 'waiting']) {
        const input = message(status),
          row       = await store.claimInbox(input);
        await store.inbox.updateOne(
          { _id: row.row.id },
          {
            $set : {
              status,
              availableAt : new Date(Date.now() + 60000),
            },
          },
        );
        assert.equal((await store.claimInbox(input)).status, status);
      }
      for (const execution of ['transactional', 'nonTransactional']) {
        const input = {
            ...message(execution),
            execution,
          },
          row       = await store.claimInbox(input);
        await store.inbox.updateOne({ _id: row.row.id }, { $set: { leaseUntil: new Date(1) } });
        const reclaimed = await store.claimInbox(input);
        assert.equal(reclaimed.status, execution === 'transactional' ? 'claimed' : 'uncertain');
        if (execution === 'transactional') assert.notEqual(reclaimed.row.token, row.row.token);
      }
      await store.inbox.updateOne(store.scoped({ messageId: 'waiting' }), {
        $set : { availableAt: new Date(1) },
      });
      assert.equal((await store.claimInbox(message('waiting'))).status, 'claimed');
      const session = await connection.startSession();
      try {
        session.startTransaction();
        commands.length = 0;
        connection.getClient().on('commandStarted', count);
        assert.equal(
          (
            await store.claimInbox({
              ...message('transaction-new'),
              session,
            })
          ).status,
          'claimed',
        );
        connection.getClient().off('commandStarted', count);
        assert.deepEqual(commands, ['find', 'insert']);
        assert.equal(
          (
            await store.claimInbox({
              ...message('new'),
              session,
            })
          ).status,
          'completed',
        );
        assert.equal(session.inTransaction(), true);
        await session.abortTransaction();
        assert.equal(
          await store.inbox.findOne(store.scoped({ messageId: 'transaction-new' })),
          null,
        );
      } finally {
        await session.endSession();
      }
      const other = await new MongoStore({
        connection,
        namespace : 'other',
        service   : 'test',
      }).initialize();
      assert.equal((await other.claimInbox(message('new'))).status, 'claimed');
    } finally {
      await database.stop();
    }
  },
);
