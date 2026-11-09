/** @file Pruebas de comportamiento de user-deletion.integration.test en service-security. */
'use strict';
const test      = require('node:test');
const assert    = require('node:assert/strict');
const fs        = require('node:fs/promises');
const os        = require('node:os');
const path      = require('node:path');
const net       = require('node:net');
const { spawn } = require('node:child_process');
test(
  'real replica set: user/session/outbox rollback, durable recovery and concurrent issuance',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : 60000,
  },

  /**
   * Verifica el comportamiento esperado del caso de prueba.
   * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
   */
  async () => {
    const mongoose  = require('mongoose');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'solid-security-'));
    const listener  = net.createServer();
    await new Promise(
      /**
       * Coordina la resolución o el rechazo de la operación asíncrona.
       * @param {Function} resolve Continuación que confirma el resultado de la promesa.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (resolve) => listener.listen(0, '127.0.0.1', resolve),
    );
    const port = listener.address().port;
    await new Promise(
      /**
       * Coordina la resolución o el rechazo de la operación asíncrona.
       * @param {Function} resolve Continuación que confirma el resultado de la promesa.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (resolve) => listener.close(resolve),
    );
    const child = spawn(
      process.env.TEST_MONGOD_BINARY,
      [
        '--dbpath',
        directory,
        '--port',
        String(port),
        '--bind_ip',
        '127.0.0.1',
        '--replSet',
        'solid',
        '--wiredTigerCacheSizeGB',
        '0.25',
        '--wiredTigerEngineConfigString',
        'log=(file_max=1MB)',
        '--setParameter',
        'diagnosticDataCollectionEnabled=false',
        '--logpath',
        path.join(directory, 'mongo.log'),
      ],
      { stdio: 'ignore' },
    );
    let admin;
    try {
      const uri = `mongodb://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 100; attempt++) {
        try {
          admin = await new mongoose.mongo.MongoClient(`${uri}/?directConnection=true`, {
            serverSelectionTimeoutMS : 100,
          }).connect();
          break;
        } catch {
          if (child.exitCode !== null)
            throw new Error(await fs.readFile(path.join(directory, 'mongo.log'), 'utf8'));
        }
      }
      assert(admin, 'isolated mongod started');
      await admin.db('admin').command({
        replSetInitiate : {
          _id     : 'solid',
          members : [
            {
              _id  : 0,
              host : `127.0.0.1:${port}`,
            },
          ],
        },
      });
      for (let i = 0; i < 100; i++) {
        if ((await admin.db('admin').command({ hello: 1 })).isWritablePrimary) break;
        await new Promise(
          /**
           * Coordina la resolución o el rechazo de la operación asíncrona.
           * @param {Function} resolve Continuación que confirma el resultado de la promesa.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (resolve) => setTimeout(resolve, 50),
        );
      }
      await mongoose.connect(`${uri}/solid_security?replicaSet=solid`, {
        serverSelectionTimeoutMS : 10000,
      });
      const usersModel    = require('../server/modules/user/models/user.model');
      const sessionsModel = require('../server/modules/session/models/session.model');
      await usersModel.createCollection();
      await sessionsModel.createCollection();
      for (const [collection, indexes] of Object.entries(
        require('../server/library/messaging/indexes.json'),
      ))
        for (const { key, ...options } of indexes)
          await mongoose.connection.db.collection(collection).createIndex(key, options);
      const { MessagingRuntime } = require('../server/library/messaging/runtime');
      const { MongoStore }       = require('../server/library/messaging/store');
      const runtime              = new MessagingRuntime({
        service   : 'service-security',
        namespace : 'solid',
        logger    : {
          /**
           * Ofrece el punto de extensión error sin efectos por defecto.
           * @returns {void} Finaliza después de aplicar los efectos de la operación.
           */
          error() {},
        },
      });
      runtime.store = new MongoStore({
        connection : mongoose.connection,
        namespace  : 'solid',
        service    : 'service-security',
      });
      await runtime.store.initialize();
      const messaging = require('../server/library/messaging/facade').createFacade(runtime);
      const users     = require('../server/modules/user/repositories/user.repository')({
        model : usersModel,
        messaging,
      });
      await require('./contracts/user-repository.contract.cjs').verifyUserRepository(users);
      await require('./contracts/security-repositories.contract.cjs').verifySecurityRepositories(
        messaging,
      );
      const sessions       = require('../server/modules/session/repositories/session.repository')({
        model : sessionsModel,
        messaging,
      });
      /**
       * Compone createDeletion con las dependencias recibidas y devuelve su interfaz.
       * @param {*} extra Valor de extra utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      const createDeletion = (extra) =>
        require('../server/modules/user/services/user-deletion.service').userDeletionService({
          messaging,
          users,
          sessions,
          ...extra,
        });
      const context        = {
        user          : { userCode: 'admin' },
        policies      : ['security.user.delete.global'],
        idTransaction : 'fixture',
      };
      /**
       * Ejecuta user dentro del flujo de user-deletion.integration.test.
       * @param {string} code Identificador público del recurso.
       * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      const user           = (code) => ({
        userCode             : code,
        user                 : `${code}@example.invalid`,
        workspace            : 'w',
        userCreate           : '',
        userAssigned         : '',
        erased               : false,
        state                : 'active',
        validity             : Date.now() + 3600000,
        credentialsChangedAt : 0,
      });
      /**
       * Ejecuta session dentro del flujo de user-deletion.integration.test.
       * @param {string} code Identificador público del recurso.
       * @param {*} suffix Valor de suffix utilizado por esta operación.
       * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      const session        = (code, suffix) => ({
        userCode        : code,
        sessionCode     : `${code}-${suffix}`,
        token           : `fixture-${code}-${suffix}`,
        workspace       : 'w',
        userCreate      : code,
        userAssigned    : code,
        activeWorkspace : 'w',
        active          : true,
        expiration      : Date.now() / 1000 + 3600,
      });
      await messaging.runWithContext(
        context,

        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
         */
        async () => {
          await usersModel.collection.insertOne(user('rollback'));
          await sessionsModel.collection.insertMany(
            Array.from(
              { length: 205 },

              /**
               * Construye un elemento de la colección resultante.
               * @param {*} _ Valor de _ utilizado por esta operación.
               * @param {*} i Valor de i utilizado por esta operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (_, i) => session('rollback', i),
            ),
          );
          const baseline = await runtime.store.outbox.countDocuments();
          const fail     = createDeletion({
            messaging : {
              ...messaging,

              /**
               * Ejecuta sendCommand dentro del flujo de user-deletion.integration.test.
               * @param {...*} args Valor de args utilizado por esta operación.
               * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              sendCommand : async (...args) => {
                if (args[1] === 'user-deletion-email') throw new Error('injected failure');
                return messaging.sendCommand(...args);
              },
            },
          });
          await assert.rejects(
            fail({
              code  : 'rollback',
              scope : 'global',
            }),
          );
          assert.equal((await usersModel.findOne({ userCode: 'rollback' })).erased, false);
          assert.equal(
            await sessionsModel.countDocuments({
              userCode : 'rollback',
              active   : true,
            }),
            205,
          );
          assert.equal(await runtime.store.outbox.countDocuments(), baseline);
          const remove = createDeletion();
          await remove({
            code  : 'rollback',
            scope : 'global',
          });
          assert.equal(
            await sessionsModel.countDocuments({
              userCode : 'rollback',
              active   : true,
            }),
            0,
          );
          const count = await runtime.store.outbox.countDocuments();
          assert.equal(count - baseline, 208);
          await remove({
            code  : 'rollback',
            scope : 'global',
          });
          assert.equal(await runtime.store.outbox.countDocuments(), count);
          const restartedStore = new MongoStore({
            connection : mongoose.connection,
            namespace  : 'solid',
            service    : 'service-security',
          });
          await restartedStore.initialize();
          const pending = await restartedStore.claimOutbox();
          assert(pending?.messageId);
          assert(
            !JSON.stringify((await usersModel.findOne({ userCode: 'rollback' })).toJSON()).includes(
              'deletionDate',
            ),
          );
          for (const deletionFirst of [false, true]) {
            const code = deletionFirst ? 'delete-first' : 'issue-first';
            await usersModel.collection.insertOne(user(code));
            let release, locked;
            const ready = new Promise(
              /**
               * Coordina la resolución o el rechazo de la operación asíncrona.
               * @param {Function} resolve Continuación que confirma el resultado de la promesa.
               * @returns {void} Finaliza después de aplicar los efectos de la operación.
               */
              (resolve) => {
                locked = resolve;
              },
            );
            const gate  = new Promise(
              /**
               * Coordina la resolución o el rechazo de la operación asíncrona.
               * @param {Function} resolve Continuación que confirma el resultado de la promesa.
               * @returns {void} Finaliza después de aplicar los efectos de la operación.
               */
              (resolve) => {
                release = resolve;
              },
            );
            /**
             * Ejecuta issue dentro del flujo de user-deletion.integration.test.
             * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
             */
            const issue = () =>
              messaging.transaction(
                /**
                 * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
                 * @param {*} txn Valor de txn utilizado por esta operación.
                 * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                 */
                async (txn) => {
                  await users.lockForSession(code, 0, txn);
                  if (!deletionFirst) {
                    locked();
                    await gate;
                  }
                  return sessions.create(
                    session(code, 'new'),
                    require('../server/modules/session/policies/session.policy').trustedScopes
                      .guest,
                    txn,
                  );
                },
              );
            let removal, issuing;
            if (deletionFirst) {
              const blocked = createDeletion({
                sessions : {
                  ...sessions,

                  /**
                   * Ejecuta revokeForUser dentro del flujo de user-deletion.integration.test.
                   * @param {...*} args Valor de args utilizado por esta operación.
                   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                   */
                  revokeForUser : async (...args) => {
                    locked();
                    await gate;
                    return sessions.revokeForUser(...args);
                  },
                },
              });
              removal = blocked({
                code,
                scope : 'global',
              });
              await ready;
              issuing = issue();
            } else {
              issuing = issue();
              await ready;
              removal = remove({
                code,
                scope : 'global',
              });
            }
            // Observe the competing promise immediately to avoid an unhandled rejection.
            const completed = Promise.allSettled([issuing, removal]);
            release();
            const results = await completed;
            assert.equal(results[1].status, 'fulfilled');
            assert.equal(
              await sessionsModel.countDocuments({
                userCode : code,
                active   : true,
              }),
              0,
            );
            if (deletionFirst) assert.equal(results[0].status, 'rejected');
          }
        },
      );
    } finally {
      await mongoose.disconnect();
      await admin?.close();
      child.kill('SIGTERM');
      await new Promise(
        /**
         * Coordina la resolución o el rechazo de la operación asíncrona.
         * @param {Function} resolve Continuación que confirma el resultado de la promesa.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (resolve) => (child.exitCode !== null ? resolve() : child.once('exit', resolve)),
      );
      await fs.rm(directory, {
        recursive : true,
        force     : true,
      });
    }
  },
);
