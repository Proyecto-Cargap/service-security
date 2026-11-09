/** @file Capacidad interna de autorización: cardinalidad completa, proyección mínima y denegación sin acceso a MongoDB. */
'use strict';
const test           = require('node:test');
const assert         = require('node:assert/strict');
const { accessRead } = require('../server/adapters/persistence/access-read');
test('lee cientos de permisos en una consulta acotada, sin count y sin aceptar alcance público', /** @returns {Promise<void>} Rechaza códigos no explícitos y datos corruptos sin truncar permisos. */ async () => {
  const guest  = Symbol('guest');
  let queries  = 0;
  let rows     = Array.from(
    { length: 482 },
    /** @param {*} value Posición. @param {number} index Índice. @returns {Object} Permiso sintético. */ (
      value,
      index,
    ) => ({ identifier: `permission-${index}` }),
  );
  const codes  = rows.map(
    /** @param {Object} row Permiso. @returns {string} Código explícito. */ (row) => row.identifier,
  );
  const read   = accessRead({
    codeField : 'policyCode',
    fields    : 'identifier -_id',
    messaging : {
      /** @returns {Object} Contexto acreditado. */ getContext() {
        return {};
      },
    },
    policy    : {
      trustedScopes : { guest },
      /** @param {string} operation Consulta. @param {Object} filter Filtro interno. @returns {Object} Selección autorizada. */ authorize(
        operation,
        filter,
      ) {
        assert.equal(operation, 'view');
        return filter;
      },
    },
    model     : {
      /** @param {Object} filter Filtro vigente. @param {string} fields Proyección cerrada. @returns {Object} Única consulta permitida. */
      find(filter, fields) {
        queries++;
        assert.deepEqual(filter.policyCode.$in, codes);
        assert.equal(fields, 'identifier -_id');
        return {
          /** @param {number} value Límite de integridad. @returns {Object} Consulta con proyección lean. */ limit(
            value,
          ) {
            assert.equal(value, 483);
            return {
              /** @returns {Promise<Object[]>} Datos mínimos. */ async lean() {
                return rows;
              },
            };
          },
        };
      },
    },
  });
  const filter = {
    policyCode : { $in: codes },
    erased     : false,
    active     : true,
  };
  assert.equal((await read(filter, guest)).length, 482);
  assert.equal(queries, 1);
  await assert.rejects(read(filter, 'guest'), { statusCode: 403 });
  await assert.rejects(read({}, guest), { statusCode: 400 });
  await assert.rejects(read({ policyCode: { $in: Array(10001).fill('code') } }, guest), {
    statusCode : 400,
  });
  assert.deepEqual(await read({ policyCode: { $in: [] } }, guest), []);
  assert.equal(queries, 1);
  rows = [...rows, {}];
  await assert.rejects(read(filter, guest), { statusCode: 409 });
});
