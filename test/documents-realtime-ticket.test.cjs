/** @file Contrato de tickets: consumo exclusivo, caducidad, origen y permisos vigentes. */
'use strict';
const test                = require('node:test');
const assert              = require('node:assert/strict');
const { randomBytes }     = require('node:crypto');
const { realtimeTickets } = require('../server/modules/oauth/services/realtime-tickets.service');
/** @returns {Object} Reloj y almacenamiento con consumo atómico sin servicios externos. */
function fixture() {
  const records = new Map(),
    state       = {
      now       : 100000,
      revoked   : false,
      workspace : 'W1',
      scopes    : ['documents:read'],
    };
  const principal = {
    userCode   : 'U1',
    clientId   : 'C1',
    grantCode  : 'G1',
    workspace  : 'W1',
    workspaces : ['W1', 'W2'],
    policies   : [],
    expiresAt  : 9000000,
  };
  const store     = {
    /** @param {Object} value Ticket. @returns {Promise<void>} Registro aislado. */ async put(
      value,
    ) {
      records.set(value.id, structuredClone(value));
    },
    /** @param {Object} value Selector. @returns {Promise<Object>} Copia independiente. */ async get(
      value,
    ) {
      return structuredClone(records.get(value.id));
    },
    /** @param {Object} value Selector. @returns {Promise<boolean>} Compare-and-set. */ async consume(
      value,
    ) {
      const record = records.get(value.id);
      if (!record || record.consumed) return false;
      record.consumed = true;
      return true;
    },
  };
  const service   = realtimeTickets({
    store,
    /** @returns {Object} Contexto autenticado. */ context       : () => ({
      user       : { userCode: 'U1' },
      workspace  : state.workspace,
      delegation : {
        grantCode : 'G1',
        clientId  : 'C1',
      },
    }),
    /** @param {Object} value Selección. @returns {Promise<Object>} Principal vigente. */ async resolve(
      value,
    ) {
      if (state.revoked) throw Object.assign(new Error('revoked'), { statusCode: 401 });
      return {
        ...principal,
        workspace : value.workspace,
        scopes    : state.scopes,
      };
    },
    /** @returns {number} Reloj. */ now                          : () => state.now,
    /** @returns {string} Entropía criptográfica. */ randomToken : () =>
      randomBytes(32).toString('base64url'),
  });
  return {
    service,
    state,
    records,
  };
}
test('ticket opaco, vida de 60 segundos, una sola conexión y espacio inmutable', /** @returns {Promise<void>} Verifica doble consumo concurrente. */ async () => {
  const f  = fixture(),
    issued = await f.service.create({}, 'service-apigateway');
  assert.match(issued.ticket, /^[\w-]{43}$/);
  assert.equal(issued.expiresAt - f.state.now, 60000);
  f.state.workspace = 'W2';
  const outcomes = await Promise.allSettled([
    f.service.consume(issued, 'service-platform'),
    f.service.consume(issued, 'service-platform'),
  ]);
  assert.equal(
    outcomes.filter(
      /** @param {Object} value Resultado. @returns {boolean} Éxito. */ (value) =>
        value.status === 'fulfilled',
    ).length,
    1,
  );
  const success = outcomes.find(
    /** @param {Object} value Resultado. @returns {boolean} Éxito. */ (value) =>
      value.status === 'fulfilled',
  ).value;
  assert.equal(success.workspace, 'W1');
  assert.equal(success.channel, 'realtime');
  assert.equal(success.expiresAt - f.state.now, 600000);
});
test('rechaza origen, ticket expirado y concesión revocada o sin lectura documental', /** @returns {Promise<void>} No entrega datos después del cambio de acceso. */ async () => {
  const f = fixture();
  await assert.rejects(f.service.create({}, 'service-platform'), { statusCode: 403 });
  const issued = await f.service.create({}, 'service-apigateway');
  await assert.rejects(f.service.consume(issued, 'service-apigateway'), { statusCode: 403 });
  f.state.now += 60000;
  await assert.rejects(f.service.consume(issued, 'service-platform'), { statusCode: 401 });
  const next = await f.service.create({}, 'service-apigateway');
  f.state.revoked = true;
  await assert.rejects(f.service.consume(next, 'service-platform'), { statusCode: 401 });
  f.state.revoked = false;
  f.state.scopes = [];
  await assert.rejects(f.service.create({}, 'service-apigateway'), { statusCode: 403 });
});
