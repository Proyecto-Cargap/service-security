/** @file Pruebas de comportamiento de user-deletion.test en service-security. */
'use strict';
const test                    = require('node:test');
const assert                  = require('node:assert/strict');
const { userDeletionService } = require('../server/modules/user/services/user-deletion.service');
const {
  userDeletionEmail,
} = require('../server/modules/user/handlers/user-deletion-email.handler');

/**
 * Ejecuta fixture dentro del flujo de user-deletion.test.
 * @param {Object} [options] Colaboradores u opciones: fail.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function fixture({ fail } = {}) {
  let state = {
    user     : {
      password             : 'private-fixture',
      activationToken      : 'private-fixture',
      credentialsChangedAt : 1,
      userCode             : 'u',
      workspace            : 'w',
      userCreate           : '',
      userAssigned         : '',
      user                 : 'user@example.invalid',
      erased               : false,
      updateDate           : 1,
    },
    sessions : Array.from(
      { length: 205 },

      /**
       * Construye un elemento de la colección resultante.
       * @param {*} _ Valor de _ utilizado por esta operación.
       * @param {*} i Valor de i utilizado por esta operación.
       * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (_, i) => ({
        sessionCode : `s${i}`,
        active      : true,
      }),
    ),
    outbox   : [],
  };
  let active;
  const messaging = {
    /**
     * Resuelve getContext aplicando los filtros y colaboradores del módulo.
     * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    getContext   : () => ({
      user     : { userCode: 'admin' },
      policies : ['security.user.delete.global'],
    }),
    /**
     * Ejecuta transaction dentro del flujo de user-deletion.test.
     * @param {Function} work Valor de work utilizado por esta operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async transaction(work) {
      const before = structuredClone(state);
      active = {
        /**
         * Ejecuta inTransaction dentro del flujo de user-deletion.test.
         * @returns {boolean} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        inTransaction : () => true,
      };
      try {
        return await work(active);
      } catch (error) {
        state = before;
        throw error;
      } finally {
        active = null;
      }
    },
    /**
     * Ejecuta sendCommand dentro del flujo de user-deletion.test.
     * @param {string} target Valor de target utilizado por esta operación.
     * @param {string} action Valor de action utilizado por esta operación.
     * @param {Object} data Datos de entrada de la operación.
     * @param {Object} options Opciones que delimitan el comportamiento de la operación.
     * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
     */
    async sendCommand(target, action, data, options) {
      assert.equal(options.session, active);
      assert.equal(JSON.stringify(data).includes('private-fixture'), false);
      assert.equal(JSON.stringify(data).includes('credentialsChangedAt'), false);
      if (action === fail) throw new Error('injected failure');
      if (
        !state.outbox.some(
          /**
           * Comprueba si el elemento satisface la condición.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => row.id === options.publicationId,
        )
      )
        state.outbox.push({
          id : options.publicationId,
          target,
          action,
          data,
        });
    },
    /**
     * Ejecuta publishEvent dentro del flujo de user-deletion.test.
     * @param {string} action Valor de action utilizado por esta operación.
     * @param {Object} data Datos de entrada de la operación.
     * @param {Object} options Opciones que delimitan el comportamiento de la operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    publishEvent : async (action, data, options) =>
      messaging.sendCommand('event', action, data, options),
  };
  const users     = {
    /**
     * Obtiene el registro que cumple los filtros autorizados.
     * @param {Object} filter Filtros de selección que se autorizan antes de consultar.
     * @param {string|symbol} scope Alcance solicitado o marcador interno de confianza.
     * @param {Object} session Sesión que agrupa las operaciones de persistencia.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async getOne(filter, scope, session) {
      assert.equal(session, active);
      return structuredClone(state.user);
    },
    /**
     * Ejecuta markDeleted dentro del flujo de user-deletion.test.
     * @param {Object} filter Filtros de selección que se autorizan antes de consultar.
     * @param {string|symbol} scope Alcance solicitado o marcador interno de confianza.
     * @param {Object} session Sesión que agrupa las operaciones de persistencia.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async markDeleted(filter, scope, session) {
      assert.equal(session, active);
      state.user = {
        ...state.user,
        erased       : true,
        deletionDate : 2,
        updateDate   : 2,
      };
      return structuredClone(state.user);
    },
  };
  const sessions  = {
    /**
     * Ejecuta revokeForUser dentro del flujo de user-deletion.test.
     * @param {string} code Identificador público del recurso.
     * @param {Object} session Sesión que agrupa las operaciones de persistencia.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async revokeForUser(code, session) {
      assert.equal(session, active);
      assert.equal(code, 'u');
      const closed = state.sessions
        .filter(
          /**
           * Determina si el elemento cumple el criterio de selección.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => row.active,
        )
        .map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => ({
            ...row,
            active : false,
          }),
        );
      state.sessions = state.sessions.map(
        /**
         * Proyecta cada elemento en la estructura requerida por la operación.
         * @param {*} row Valor de row utilizado por esta operación.
         * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (row) => ({
          ...row,
          active : false,
        }),
      );
      return closed;
    },
  };
  return {
    remove : userDeletionService({
      messaging,
      users,
      sessions,
    }),

    /**
     * Lee el contenido o registro solicitado.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    read   : () => state,
    messaging,
  };
}
test('deletion revokes every session and stages effects without requiring Platform' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const f = fixture();
  await f.remove({
    code  : 'u',
    scope : 'global',
  });
  assert(f.read().user.erased);
  assert(
    f.read().sessions.every(
      /**
       * Comprueba la condición requerida para cada elemento.
       * @param {*} row Valor de row utilizado por esta operación.
       * @returns {boolean} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (row) => !row.active,
    ),
  );
  assert.equal(
    f.read().outbox.filter(
      /**
       * Determina si el elemento cumple el criterio de selección.
       * @param {*} row Valor de row utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (row) => row.action === 'direct-send-channel',
    ).length,
    0,
  );
  assert.equal(
    f.read().outbox.filter(
      /**
       * Determina si el elemento cumple el criterio de selección.
       * @param {*} row Valor de row utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (row) => row.action === 'user-deletion-email',
    ).length,
    1,
  );
  const count = f.read().outbox.length;
  await f.remove({
    code  : 'u',
    scope : 'global',
  });
  assert.equal(f.read().outbox.length, count);
});
test('failure staging an effect rolls back user, sessions and all staged publications' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const f = fixture({ fail: 'user-deletion-email' });
  await assert.rejects(
    f.remove({
      code  : 'u',
      scope : 'global',
    }),
  );
  assert.equal(f.read().user.erased, false);
  assert(
    f.read().sessions.every(
      /**
       * Comprueba la condición requerida para cada elemento.
       * @param {*} row Valor de row utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (row) => row.active,
    ),
  );
  assert.equal(f.read().outbox.length, 0);
});
test('replication flag suppresses only the public event and unauthorized input writes nothing' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const f = fixture();
  await assert.rejects(
    f.remove({
      code  : 'u',
      scope : null,
    }),

    /**
     * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
     * @param {*} e Valor de e utilizado por esta operación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (e) => e.statusCode === 403,
  );
  assert.equal(f.read().outbox.length, 0);
  await f.remove({
    code     : 'u',
    scope    : 'global',
    MQReplic : false,
  });
  assert(
    !f.read().outbox.some(
      /**
       * Comprueba si el elemento satisface la condición.
       * @param {*} row Valor de row utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (row) => row.action === 'security.user.delete',
    ),
  );
});
test('post-commit email reads branding outside the transaction and accepts a stable command' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  let transaction = false,
    reads         = 0;
  const ids       = [];
  const handler   = userDeletionEmail({
    users       : {
      /**
       * Obtiene el registro que cumple los filtros autorizados.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getOne : async () => ({
        workspace : 'w',
        user      : 'u@example.invalid',
      }),
    },
    information : {
      /**
       * Obtiene el valor solicitado.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      get : async () => {
        assert(!transaction);
        reads++;
        return {
          title : 'Platform',
          logos : { email: 'https://example.invalid/logo' },
          theme : { primary: { 900: '#123456' } },
        };
      },
    },
    messaging   : {
      /**
       * Ejecuta transaction dentro del flujo de user-deletion.test.
       * @param {Function} work Valor de work utilizado por esta operación.
       * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
       */
      transaction : async (work) => {
        transaction = true;
        try {
          await work({});
        } finally {
          transaction = false;
        }
      },
      /**
       * Ejecuta sendCommand dentro del flujo de user-deletion.test.
       * @param {string} target Valor de target utilizado por esta operación.
       * @param {string} action Valor de action utilizado por esta operación.
       * @param {Object} data Datos de entrada de la operación.
       * @param {Object} options Opciones que delimitan el comportamiento de la operación.
       * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
       */
      sendCommand : async (target, action, data, options) => {
        assert(transaction);
        ids.push(options.publicationId);
      },
    },
  });
  const execution = {
    kind    : 'command',
    message : { source: 'service-security' },
  };
  await handler(
    {
      userCode     : 'u',
      deletionDate : 2,
    },
    execution,
  );
  await handler(
    {
      userCode     : 'u',
      deletionDate : 2,
    },
    execution,
  );
  assert.equal(reads, 2);
  assert.equal(new Set(ids).size, 1);
  await assert.rejects(
    handler(
      {
        userCode     : 'u',
        deletionDate : 2,
      },
      {
        kind    : 'command',
        message : { source: 'service-connect' },
      },
    ),
  );
});
test('branding failure is retryable before any email acceptance' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const handler = userDeletionEmail({
    users       : {
      /**
       * Obtiene el registro que cumple los filtros autorizados.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getOne : async () => ({}),
    },
    information : {
      /**
       * Obtiene el valor solicitado.
       * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
       */
      get : async () => {
        throw new Error('offline');
      },
    },
    messaging   : {
      /**
       * Ejecuta transaction dentro del flujo de user-deletion.test.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      transaction : () => assert.fail('unexpected transaction'),
    },
  });
  await assert.rejects(
    handler(
      {
        userCode     : 'u',
        deletionDate : 2,
      },
      {
        kind    : 'command',
        message : { source: 'service-security' },
      },
    ),

    /**
     * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
     * @param {*} e Valor de e utilizado por esta operación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (e) => e.retryable && !e.uncertain,
  );
});
