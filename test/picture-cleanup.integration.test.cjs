/** @file Verifica limpieza por Change Streams con Mongo real, reinicios, exclusión, rollback e inactividad sin sondeos. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { randomUUID }         = require('node:crypto');
const { setTimeout: delay }  = require('node:timers/promises');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const {
  pictureCleanupRepository,
} = require('../server/modules/workspaces/repositories/picture-cleanup.repository');
const {
  pictureCleanupWorker,
} = require('../server/modules/workspaces/workers/picture-cleanup.worker');
const { createMongoChanges }    = require('../server/library/work/mongo-changes');
const { createAccessMutations } = require('../server/adapters/persistence/access-mutations');
/** @param {Function} condition Condición de prueba. @returns {Promise<void>} Espera acotada sólo en el controlador de integración. */
async function eventually(condition) {
  const until = Date.now() + 12000;
  while (!(await condition())) {
    assert.ok(Date.now() < until, 'La condición no se confirmó dentro del plazo.');
    await delay(20);
  }
}
test(
  'limpieza durable: cambio atómico, dos instancias, reinicio, fencing y reposo sin consultas',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : Number(process.env.SECURITY_CLEANUP_IDLE_MS || 300) + 45000,
  },
  /** @param {Object} t Contexto. @returns {Promise<void>} Todos los datos pertenecen al replica set temporal. */ async (
    t,
  ) => {
    const database = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    const workers  = [];
    t.after(
      /** @returns {Promise<void>} Cierra exclusivamente recursos de esta prueba. */ async () => {
        await Promise.all(
          workers.map(
            /** @param {Object} worker Trabajador. @returns {Promise<void>} Cierre independiente. */ (
              worker,
            ) => worker.close(),
          ),
        );
        await database.stop();
      },
    );
    const originalWorkspace = require('../server/modules/workspaces/models/workspaces.model');
    const originalQueue     = require('../server/modules/workspaces/models/picture-cleanup.model');
    const workspaces        = database.connection.model(
      originalWorkspace.modelName,
      originalWorkspace.schema,
      originalWorkspace.collection.name,
    );
    const model             = database.connection.model(
      originalQueue.modelName,
      originalQueue.schema,
      originalQueue.collection.name,
    );
    await workspaces.createCollection();
    await database.connection.db.createCollection('TEST_CLEANUP_OUTBOX');
    let rejectOutbox = false;
    const messaging  = {
      /** @returns {Object} Identidad mínima del caso de prueba. */ getContext() {
        return {};
      },
      /** @param {string} name Hecho. @param {Object} data Referencia. @param {Object} options Sesión atómica. @returns {Promise<void>} Outbox real y fallo posterior a la escritura. */
      async publishEvent(name, data, options) {
        assert.ok(options.session.inTransaction());
        await database.connection.db.collection('TEST_CLEANUP_OUTBOX').insertOne(
          {
            name,
            data,
          },
          options,
        );
        if (rejectOutbox) throw new Error('OUTBOX_FAILED');
      },
    };
    const repository = pictureCleanupRepository({
      model,
      workspaces,
      /** @param {Function} work Confirmación transaccional. @returns {Promise<Object>} Usa la sesión explícita. */
      transaction : (work) => database.connection.transaction(work),
      clock       : Date.now,
      newId       : randomUUID,
      leaseMs     : 300,
    });
    await repository.prepare();
    const mutations = createAccessMutations({
      model         : workspaces,
      messaging,
      resource      : 'workspace',
      codeField     : 'workspaceCode',
      queuePictures : repository.enqueue,
    });
    await workspaces.create({
      workspaceCode  : 'C1',
      name           : 'Workspace',
      workspace      : 'W1',
      userCreate     : 'U1',
      userAssigned   : '',
      pictureFile    : { id: 'current' },
      pictureCleanup : [],
    });
    /** @returns {Promise<Object>} Cambio de negocio instrumentado con el mismo outbox y cola del servicio. */
    function changePicture() {
      return mutations.update({ workspaceCode: 'C1' }, { $set: { pictureCleanup: ['old'] } });
    }

    rejectOutbox = true;
    await assert.rejects(changePicture, /OUTBOX_FAILED/);
    assert.equal(await model.countDocuments(), 0);
    assert.deepEqual((await workspaces.findOne({ workspaceCode: 'C1' })).pictureCleanup, []);
    rejectOutbox = false;
    await changePicture();
    assert.equal(await model.countDocuments(), 1);
    let nextReads = 0,
      active      = 0,
      maxActive   = 0,
      effects     = 0,
      fail        = true;
    const nextAt = repository.nextAt;
    /** @returns {Promise<number|undefined>} Cuenta consultas causadas por eventos y vencimientos. */
    repository.nextAt = () => {
      nextReads++;
      return nextAt();
    };
    const logger   = { /** @returns {void} Omite registros sintéticos. */ error() {} };
    const pictures = {
      /** @param {string} fileId Archivo reclamado. @param {string} code Propietario. @returns {Promise<boolean>} Fallo inicial y confirmación posterior idempotente. */
      async remove(fileId, code) {
        assert.equal(code, 'C1');
        assert.equal(fileId, 'old');
        maxActive = Math.max(maxActive, ++active);
        effects++;
        await delay(30);
        active--;
        return !fail;
      },
    };
    /** @returns {Object} Nueva instancia sobre la misma cola, con cursor propio. */
    function instance() {
      const worker = pictureCleanupWorker({
        repository,
        pictures,
        logger,
        source : createMongoChanges({
          connection  : database.connection,
          collections : [model.collection.name],
          logger,
          component   : 'picture_cleanup_test',
        }),
      });
      workers.push(worker);
      return worker;
    }
    const first = instance(),
      second    = instance();
    await Promise.all([first.start(), second.start()]);
    await eventually(
      /** @returns {Promise<boolean>} El fallo queda persistido y no se confirma el marcador. */ async () => {
        const job = await model.findOne().lean();
        return effects === 1 && !job?.token && job?.nextAt > Date.now();
      },
    );
    await Promise.all([first.close(), second.close()]);
    assert.deepEqual((await workspaces.findOne({ workspaceCode: 'C1' })).pictureCleanup, ['old']);
    fail = false;
    const restarted = instance();
    await restarted.start();
    await eventually(
      /** @returns {Promise<boolean>} El reinicio retoma el vencimiento durable sin una lectura de ficha. */ async () =>
        (await model.countDocuments()) === 0,
    );
    assert.equal(maxActive, 1);
    assert.equal(effects, 2);
    assert.deepEqual((await workspaces.findOne({ workspaceCode: 'C1' })).pictureCleanup, []);
    await delay(150);
    const count    = nextReads,
      priorEffects = effects;
    const idleMs = Number(process.env.SECURITY_CLEANUP_IDLE_MS || 300);
    await delay(idleMs);
    assert.equal(nextReads, count);
    assert.equal(effects, priorEffects);
    t.diagnostic(
      JSON.stringify({
        idleMs,
        workerReads : 0,
        effects     : 0,
      }),
    );
    await restarted.close();
    // La baja física conserva el trabajo en una colección independiente.
    await mutations.remove({ workspaceCode: 'C1' });
    const deletedJob = await repository.claim();
    assert.equal(deletedJob.fileId, 'current');
    assert.equal(await repository.linked(deletedJob), false);
    assert.equal(await repository.finish(deletedJob), true);
    await repository.enqueue('C1', ['old']);
    const stale = await repository.claim();
    assert.equal(await repository.claim(), null);
    await delay(320);
    const replacement = await repository.claim();
    assert.notEqual(stale.token, replacement.token);
    assert.equal(await repository.finish(stale), false);
    assert.equal(await model.countDocuments(), 1);
    assert.equal(await repository.finish(replacement), true);
  },
);
