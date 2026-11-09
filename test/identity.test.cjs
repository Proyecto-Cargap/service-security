/** @file Pruebas de comportamiento de identity.test en service-security. */
'use strict';
const test                = require('node:test');
const assert              = require('node:assert/strict');
const { identityService } = require('../server/modules/identity/services/identity.service');
const {
  identityController,
} = require('../server/modules/identity/controllers/identity.controller');
/**
 * Ejecuta fixture dentro del flujo de identity.test.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function fixture() {
  const queries      = [];
  let enabled        = true;
  const dependencies = {
    messaging  : {
      /**
       * Resuelve getContext aplicando los filtros y colaboradores del módulo.
       * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getContext      : () => ({
        user        : { userCode: 'u' },
        sessionCode : 's',
        workspace   : 'w',
      }),
      /**
       * Ejecuta successResponse dentro del flujo de identity.test.
       * @param {number} statusCode Valor de statusCode utilizado por esta operación.
       * @param {Object} data Datos de entrada de la operación.
       * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      successResponse : (statusCode, data) => ({
        statusCode,
        data,
      }),

      /**
       * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
       * @param {*} service Valor de service utilizado por esta operación.
       * @param {string} action Valor de action utilizado por esta operación.
       * @param {Object} data Datos de entrada de la operación.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      request         : async (service, action, data) => {
        assert.equal(service, 'service-directory');
        assert.equal(action, 'contact-profile-get-list');
        return {
          statusCode : 200,
          data       : {
            items : data.codes.map(
              /**
               * Proyecta cada elemento en la estructura requerida por la operación.
               * @param {*} contactCode Valor de contactCode utilizado por esta operación.
               * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (contactCode) => ({
                contactCode,
                name            : 'Name',
                hasPicture      : true,
                pictureRevision : 7,
              }),
            ),
          },
        };
      },
    },
    sessions   : {
      /**
       * Obtiene el registro que cumple los filtros autorizados.
       * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getOne : async () =>
        enabled
          ? {
              activeWorkspace : 'w',
              workspaces      : ['w'],
              policies        : ['read'],
            }
          : null,
    },
    users      : {
      /**
       * Obtiene el registro que cumple los filtros autorizados.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getOne        : async () => ({
        userCode   : 'u',
        workspaces : ['w'],
      }),

      /**
       * Resuelve getReferences aplicando los filtros y colaboradores del módulo.
       * @returns {Promise<Array<*>>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getReferences : async () => [
        {
          userCode    : 'u',
          contactCode : 'c',
        },
      ],
      /**
       * Consulta una página de registros autorizados.
       * @param {...*} args Valor de args utilizado por esta operación.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getList       : async (...args) => {
        queries.push(args);
        return {
          listItem   : [{ userCode: 'u' }],
          totalCount : 1,
        };
      },
    },
    workspaces : {
      /**
       * Resuelve getReferences aplicando los filtros y colaboradores del módulo.
       * @returns {Promise<Array<*>>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getReferences : async () => [{ workspaceCode: 'w' }],

      /**
       * Obtiene el registro que cumple los filtros autorizados.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      getOne        : async () => ({ workspaceCode: 'w' }),
    },
  };
  dependencies.authorization = {
    /** @returns {Promise<Object>} Snapshot privado del colaborador unitario; la revocación permanece observable por petición. */
    async read() {
      return {
        user       : await dependencies.users.getOne(),
        session    : await dependencies.sessions.getOne(),
        workspaces : ['w'],
      };
    },
  };
  return {
    service    : identityService(dependencies),
    controller : identityController(dependencies),
    queries,

    /**
     * Ejecuta revoke dentro del flujo de identity.test.
     * @returns {void} Finaliza después de aplicar los efectos de la operación.
     */
    revoke     : () => {
      enabled = false;
    },
  };
}
test('canonical identity and profiles are identical across authorized microservices' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const f          = fixture();
  const sources    = [
    'service-platform',
    'service-communication',
    'service-documents',
    'service-connect',
  ];
  const identities = await Promise.all(
    sources.map(
      /**
       * Proyecta cada elemento en la estructura requerida por la operación.
       * @param {string} source Valor de source utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (source) => f.service.current(source),
    ),
  );
  assert(
    identities.every(
      /**
       * Comprueba la condición requerida para cada elemento.
       * @param {*} value Valor de value utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (value) => JSON.stringify(value) === JSON.stringify(identities[0]),
    ),
  );
  const values = await Promise.all(
    sources.map(
      /**
       * Proyecta cada elemento en la estructura requerida por la operación.
       * @param {string} source Valor de source utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (source) => f.service.profiles({ codes: ['u'] }, source),
    ),
  );
  assert(
    values.every(
      /**
       * Comprueba la condición requerida para cada elemento.
       * @param {*} value Valor de value utilizado por esta operación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (value) => JSON.stringify(value) === JSON.stringify(values[0]),
    ),
  );
  assert.equal(values[0].items[0].pictureRevision, 7);
  f.revoke();
  await assert.rejects(
    f.service.current('service-platform'),

    /**
     * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
     * @param {*} e Valor de e utilizado por esta operación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (e) => e.statusCode === 401,
  );
});
test('workspace membership uses one paginated query regardless of consuming domain' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const f      = fixture();
  const data   = {
    workspace : 'w',
    userCodes : ['u'],
    page      : 1,
    perPage   : 100,
  };
  const first  = await f.service.workspaceUsers(data, 'service-platform');
  const second = await f.service.workspaceUsers(data, 'service-documents');
  assert.deepEqual(first, second);
  assert.deepEqual(f.queries[0].slice(1), f.queries[1].slice(1));
  assert.deepEqual(first.pagination, {
    page    : 1,
    perPage : 100,
    total   : 1,
  });
  await assert.rejects(
    f.service.workspaceUsers(
      {
        ...data,
        userCodes : Array(101).fill('u'),
      },
      'service-platform',
    ),
  );
});
test('consumer-specific selectors and unauthenticated sources are rejected' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const f = fixture();
  await assert.rejects(
    f.controller.profiles({
      originService : 'service-platform',
      data          : {
        codes    : ['u'],
        consumer : 'notifications',
      },
    }),

    /**
     * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
     * @param {*} e Valor de e utilizado por esta operación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (e) => e.statusCode === 400,
  );
  await assert.rejects(
    f.service.current('external'),

    /**
     * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
     * @param {*} e Valor de e utilizado por esta operación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (e) => e.statusCode === 403,
  );
});

test('Supplier consulta miembros con el mismo contrato canónico sin ampliar permisos', /** @returns {Promise<void>} Acredita el nuevo origen y conserva el resultado de los consumidores existentes. */ async () => {
  const f    = fixture();
  const data = {
    workspace : 'w',
    userCodes : ['u'],
    page      : 1,
    perPage   : 100,
  };
  assert.deepEqual(
    await f.service.workspaceUsers(data, 'service-supplier'),
    await f.service.workspaceUsers(data, 'service-platform'),
  );
  await assert.rejects(f.service.workspaceUsers(data, 'external'), { statusCode: 403 });
});

test('Projects consulta membresías canónicas sin ampliar el directorio', /** @returns {Promise<void>} Acredita origen y respuesta uniforme. */ async () => {
  const f = fixture();
  assert.deepEqual(
    await f.service.workspaceUsers(
      {
        workspace : 'w',
        userCodes : ['u'],
      },
      'service-projects',
    ),
    await f.service.workspaceUsers(
      {
        workspace : 'w',
        userCodes : ['u'],
      },
      'service-platform',
    ),
  );
});
