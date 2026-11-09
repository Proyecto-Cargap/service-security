/** @file MongoDB real: vencimientos por deadline, rollback del outbox, renovación concurrente y reposo sin sondeos. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { setTimeout: delay }  = require('node:timers/promises');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const {
  sessionExpirationRepository,
} = require('../server/modules/session/repositories/session-expiration.repository');
const {
  sessionExpirationWorker,
} = require('../server/modules/session/workers/session-expiration.worker');
const { createMongoChanges } = require('../server/library/work/mongo-changes');
const { sessionDTO }         = require('../server/modules/session/dtos/session.dto');
/** @param {Function} condition Afirmación asíncrona. @returns {Promise<void>} Espera acotada exclusiva del arnés. */
async function eventually(condition) {
  const until = Date.now() + 12000;
  while (!(await condition())) {
    assert.ok(Date.now() < until, 'La transición no llegó');
    await delay(20);
  }
}
test(
  'la expiración publica una transición sin cerrar la sesión; dos instancias, renovación, reinicio y diez minutos opcionales sin sondeos',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : Number(process.env.SECURITY_EXPIRATION_IDLE_MS || 300) + 50000,
  },
  /** @param {Object} t Ciclo de prueba. @returns {Promise<void>} Toda escritura y conexión usa un replica set temporal. */ async (
    t,
  ) => {
    const database = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    const workers = [],
      db          = database.connection;
    t.after(
      /** @returns {Promise<void>} Libera exclusivamente los recursos temporales. */ async () => {
        await Promise.all(
          workers.map(
            /** @param {Object} worker Consumidor. @returns {Promise<void>} Cierre. */ (worker) =>
              worker.close(),
          ),
        );
        await database.stop();
      },
    );
    const schema = require('../server/modules/session/models/session.model').schema.clone();
    let renew = false,
      model;
    schema.pre(
      'findOneAndUpdate',
      /** @returns {Promise<void>} Una renovación gana después de observar el vencimiento anterior y antes de la reclamación. */ async function concurrentRenewal() {
        if (!renew || !this.getUpdate().$set?.expirationNoticeFor) return;
        renew = false;
        await model.collection.updateOne(
          { sessionCode: 'renewed' },
          { $set: { expiration: Date.now() / 1000 + 3600 } },
        );
      },
    );
    model = db.model('ExpirationSessions', schema, 'TEST_EXPIRATION_SESSION');
    await model.createCollection();
    await db.db.createCollection('TEST_EXPIRATION_OUTBOX');
    const outbox     = db.db.collection('TEST_EXPIRATION_OUTBOX');
    let fail         = false;
    const messaging  = {
      /** @param {string} name Evento. @param {Object} data Referencia. @param {Object} options Transacción. @returns {Promise<void>} Confirma el mismo límite atómico que el outbox de Messaging. */
      async publishEvent(name, data, options) {
        assert.ok(options.session.inTransaction());
        await outbox.insertOne(
          {
            name,
            data,
          },
          options,
        );
        if (fail) throw new Error('OUTBOX_FAILED');
      },
    };
    const repository = sessionExpirationRepository({
      model,
      messaging,
    });
    await repository.prepare();
    /** @param {string} code Identidad. @param {number} expiration Vencimiento de servidor. @param {boolean} active Apertura. @returns {Promise<Object>} Sesión sintética sin credenciales utilizables. */
    async function create(code, expiration, active = true) {
      return model.create({
        sessionCode     : code,
        token           : 'test-' + code,
        userCode        : 'u',
        workspace       : 'w',
        activeWorkspace : 'w',
        userCreate      : 'u',
        userAssigned    : '',
        expiration,
        active,
      });
    }
    await create('expired', Date.now() / 1000 - 1);
    fail = true;
    await assert.rejects(repository.publishDue(), /OUTBOX_FAILED/);
    assert.equal((await model.findOne({ sessionCode: 'expired' })).expirationNoticeFor, undefined);
    assert.equal(await outbox.countDocuments(), 0);
    fail = false;
    const results = await Promise.all([repository.publishDue(), repository.publishDue()]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await outbox.countDocuments(), 1);
    const expired = await model.findOne({ sessionCode: 'expired' }).lean();
    assert.equal(expired.active, true);
    assert.equal(expired.end, 0);
    assert.equal(expired.revision, 1);
    assert.equal(sessionDTO(expired).state, 'expired');
    assert.equal(Object.hasOwn(sessionDTO(expired), 'expirationNoticeFor'), false);
    assert.deepEqual((await outbox.findOne()).data, {
      resource : 'session',
      code     : 'expired',
      revision : 1,
      userCode : 'u',
    });
    await create('closed', Date.now() / 1000 - 2, false);
    assert.equal(await repository.nextAt(), undefined);
    await create('renewed', Date.now() / 1000 - 1);
    renew = true;
    assert.equal(await repository.publishDue(), false);
    const renewed = await model.findOne({ sessionCode: 'renewed' });
    assert.equal(renewed.expirationNoticeFor, undefined);
    assert.equal(renewed.revision, 0);
    assert.equal(await repository.nextAt(), renewed.expiration * 1000);
    await model.updateOne({ sessionCode: 'renewed' }, { $set: { active: false } });
    let queries          = 0;
    const originalNextAt = repository.nextAt;
    /** @returns {Promise<number|undefined>} Cuenta sólo consultas del consumidor. */
    repository.nextAt = () => {
      queries++;
      return originalNextAt();
    };
    const logger = { /** @returns {void} Omite errores de fallo controlado. */ error() {} };
    /** @returns {Object} Instancia productiva con su propio Change Stream y reclamación compartida. */
    function instance() {
      const worker = sessionExpirationWorker({
        repository,
        logger,
        source : createMongoChanges({
          connection   : db,
          collections  : [model.collection.name],
          updateFields : ['active', 'erased', 'expiration', 'expirationNoticeFor'],
          logger,
          component    : 'expiration_test',
        }),
      });
      workers.push(worker);
      return worker;
    }
    const first = instance(),
      second    = instance();
    await Promise.all([first.start(), second.start()]);
    await eventually(/** @returns {boolean} Ambos streams están confirmados. */ () => queries >= 2);
    const deadline = Date.now() / 1000 + 1;
    await create('deadline', deadline);
    await eventually(
      /** @returns {Promise<boolean>} El plazo concreto produce exactamente una referencia. */ async () =>
        (await outbox.countDocuments({ 'data.code': 'deadline' })) === 1,
    );
    assert.equal((await model.findOne({ sessionCode: 'deadline' })).active, true);
    await Promise.all([first.close(), second.close()]);
    await create('restart', Date.now() / 1000 - 1);
    const restarted = instance();
    await restarted.start();
    await eventually(
      /** @returns {Promise<boolean>} Recupera el vencimiento persistido durante el reinicio. */ async () =>
        (await outbox.countDocuments({ 'data.code': 'restart' })) === 1,
    );
    await delay(1300);
    const before = queries,
      idle       = Number(process.env.SECURITY_EXPIRATION_IDLE_MS || 300);
    await delay(idle);
    assert.equal(queries, before);
    assert.equal(await outbox.countDocuments(), 3);
    // lastAccess es un heartbeat técnico y no despierta al consumidor de expiraciones.
    await model.updateOne({ sessionCode: 'expired' }, { $set: { lastAccess: Date.now() } });
    await delay(1200);
    assert.equal(queries, before);
    await create('after-idle', Date.now() / 1000 - 1);
    await eventually(
      /** @returns {Promise<boolean>} El siguiente hecho real sigue activando el consumidor. */ async () =>
        (await outbox.countDocuments({ 'data.code': 'after-idle' })) === 1,
    );
    console.log(
      JSON.stringify({
        idleMs                 : idle,
        workerReads            : 0,
        ordinaryHeartbeatReads : 0,
        instances              : 2,
        transitions            : 4,
      }),
    );
  },
);
