/** @file OAuth con MongoDB real: instantáneas nativas, vencimiento atómico, dos instancias y reposo sin sondeos. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { setTimeout: delay }  = require('node:timers/promises');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const { oauthRepository }    = require('../server/modules/oauth/repositories/oauth.repository');
const {
  grantExpirationWorker,
} = require('../server/modules/oauth/workers/grant-expiration.worker');
const { readSnapshot } = require('../server/adapters/mongodb/read-snapshot');
/** @param {Function} condition Resultado esperado. @returns {Promise<void>} Espera acotada exclusiva de este ensayo. */
async function eventually(condition) {
  const until = Date.now() + 12000;
  while (!(await condition())) {
    assert.ok(Date.now() < until, 'OAUTH_EXPIRATION_TIMEOUT');
    await delay(20);
  }
}
test(
  'OAuth comparte snapshot nativo y vence sin polling; rollback, duplicados, reinicio y deadlines',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : Number(process.env.OAUTH_EXPIRATION_IDLE_MS || 300) + 45000,
  },
  /** @param {Object} t Ciclo aislado. @returns {Promise<void>} No utiliza sesiones ni concesiones reales. */
  async (t) => {
    const database = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    const connection = database.connection,
      db             = connection.db,
      workers        = [];
    t.after(
      /** @returns {Promise<void>} Libera sólo conexiones y procesos temporales. */
      async () => {
        await Promise.all(
          workers.map(
            /** @param {Object} worker Consumidor. @returns {Promise<void>} Cierre independiente. */ (
              worker,
            ) => worker.close(),
          ),
        );
        await database.stop();
      },
    );
    await db.createCollection('SECURITY_OAUTH_GRANT');
    await db.createCollection('SECURITY_OAUTH_RECORD');
    await db.createCollection('TEST_OAUTH_OUTBOX');
    const outbox = db.collection('TEST_OAUTH_OUTBOX');
    let reject   = false;
    const store  = oauthRepository({
      /** @returns {Object} Base temporal. */ db                                                                       : () => db,
      /** @param {string} value Artefacto sintético. @returns {string} Identidad sólo para datos del ensayo. */ digest :
        (value) => value,
      transaction                                                                                                      : connection.transaction.bind(connection),
      /** @returns {Object|undefined} Sesión del snapshot que también usa Mongoose. */ readSession                     :
        () => connection.base.transactionAsyncLocalStorage?.getStore()?.session,
      /** @param {string} name Nombre del hecho. @param {Object} data Referencia pública. @param {Object} options Transacción. @returns {Promise<void>} Estado y outbox fallan juntos. */
      async publishEvent(name, data, options) {
        assert.ok(options.session.inTransaction());
        await outbox.insertOne(
          {
            name,
            data,
          },
          options,
        );
        if (reject) throw new Error('OUTBOX_FAILED');
      },
    });
    /** @param {string} code Identidad. @param {number} expiresAt Fecha concreta. @returns {Promise<void>} Concesión de prueba. */
    async function create(code, expiresAt) {
      await store.createGrant({
        code,
        userCode  : 'u',
        createdAt : Date.now(),
        expiresAt,
        active    : true,
      });
    }
    await store.prepareExpiration();
    await create('snapshot', Date.now() + 3600000);
    const snapshot = readSnapshot({
      mongoose,
      connection,
    });
    await snapshot(
      /** @returns {Promise<void>} La revocación externa no altera ninguna fila de la instantánea en curso. */
      async () => {
        assert.equal((await store.listGrants('u', 1))[0].active, true);
        await db
          .collection('SECURITY_OAUTH_GRANT')
          .updateOne({ code: 'snapshot' }, { $set: { active: false } });
        assert.equal((await store.listGrants('u', 1))[0].active, true);
        assert.equal((await store.getGrant('snapshot')).active, true);
      },
    );
    assert.equal((await store.getGrant('snapshot')).active, false);
    await create('due', Date.now() - 1);
    await store.put(
      {
        model   : 'RefreshToken',
        id      : 'synthetic',
        grantId : 'due',
        ttl     : 60,
        payload : '{}',
      },
      Date.now(),
    );
    reject = true;
    await assert.rejects(store.expireDue(Date.now()), /OUTBOX_FAILED/);
    assert.equal((await store.getGrant('due')).active, true);
    assert.equal(await db.collection('SECURITY_OAUTH_RECORD').countDocuments(), 1);
    reject = false;
    const winners = await Promise.all([store.expireDue(Date.now()), store.expireDue(Date.now())]);
    assert.equal(winners.filter(Boolean).length, 1);
    assert.equal(await db.collection('SECURITY_OAUTH_RECORD').countDocuments(), 0);
    assert.equal(await outbox.countDocuments({ 'data.code': 'due' }), 2);
    assert.equal((await store.getGrant('due')).revision, 2);
    let reads      = 0;
    const original = store.nextExpirationAt;
    /** @returns {Promise<number|undefined>} Cuenta únicamente las consultas de pendientes del trabajador. */
    store.nextExpirationAt = () => {
      reads++;
      return original();
    };
    const logger = {
      /** @returns {void} Un fallo del consumidor no se omite en este ensayo. */ error() {
        assert.fail('OAUTH_WORKER_FAILED');
      },
    };
    /** @returns {Object} Una instancia productiva con stream propio y persistencia compartida. */
    function instance() {
      const worker = grantExpirationWorker({
        store,
        connection,
        logger,
      });
      workers.push(worker);
      return worker;
    }
    const first = instance(),
      second    = instance();
    await Promise.all([first.start(), second.start()]);
    await eventually(/** @returns {boolean} Ambos streams confirmados. */ () => reads >= 2);
    await create('deadline', Date.now() + 800);
    await eventually(
      /** @returns {Promise<boolean>} El vencimiento conocido cambia una vez el estado. */ async () =>
        (await store.getGrant('deadline')).active === false,
    );
    assert.equal(await outbox.countDocuments({ 'data.code': 'deadline' }), 2);
    await Promise.all([first.close(), second.close()]);
    await create('restart', Date.now() - 1);
    const restarted = instance();
    await restarted.start();
    await eventually(
      /** @returns {Promise<boolean>} Recupera el vencimiento persistido durante la detención. */ async () =>
        (await store.getGrant('restart')).active === false,
    );
    await delay(1300);
    const before = reads,
      idle       = Number(process.env.OAUTH_EXPIRATION_IDLE_MS || 300);
    await delay(idle);
    assert.equal(reads, before);
    await create('after-idle', Date.now() - 1);
    await eventually(
      /** @returns {Promise<boolean>} El siguiente cambio real despierta la instancia. */ async () =>
        (await store.getGrant('after-idle')).active === false,
    );
    assert.equal(await outbox.countDocuments({ 'data.code': 'after-idle' }), 2);
    console.log(
      JSON.stringify({
        oauthIdleMs        : idle,
        workerReads        : 0,
        instances          : 2,
        snapshotConsistent : true,
      }),
    );
  },
);
