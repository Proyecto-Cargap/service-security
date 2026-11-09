/** @file Comprueba el contrato público de identidad al autenticar una delegación OAuth. */
'use strict';
const assert = require('node:assert/strict');
const test   = require('node:test');
const {
  identityAuthorizationService,
} = require('../server/modules/identity/services/identity-authorization.service');
const { createActionDtos } = require('../server/contracts/action-dto');
const dto                  = createActionDtos(['identity-get-current'])['identity-get-current'];

test('la identidad OAuth cumple el DTO público sin devolver metadatos de delegación' /** @returns {Promise<void>} Comprueba la salida real contra su contrato cerrado. */, async () => {
  const delegation = {
    grantCode : 'synthetic-grant',
    clientId  : 'synthetic-client',
  };
  const principal  = {
    userCode   : 'synthetic-user',
    workspace  : 'synthetic-workspace',
    workspaces : ['synthetic-workspace'],
    policies   : ['communication:read'],
    delegation,
  };
  const context    = { delegation };
  const service    = identityAuthorizationService({
    /** @returns {void} Acepta el origen sintético sin infraestructura. */
    origin() {},
    messaging : {
      /** @returns {Object} Contexto sintético de la solicitud. */
      getContext : () => context,
    },
    /** @param {Object} actor Contexto recibido. @param {string} source Servicio solicitante.
     * @returns {Promise<Object>} Identidad acreditada con metadatos internos. */
    async authenticateDelegation(actor, source) {
      assert.equal(actor, context);
      assert.equal(source, 'service-communication');
      return principal;
    },
  });
  const result     = dto.output({
    statusCode : 200,
    data       : await service.current('service-communication'),
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.data, {
    userCode   : principal.userCode,
    workspace  : principal.workspace,
    workspaces : principal.workspaces,
    policies   : principal.policies,
  });
  assert.equal(principal.delegation, delegation);
});

test('una delegación denegada conserva el error de autorización' /** @returns {Promise<void>} Verifica que el rechazo original llegue al consumidor. */, async () => {
  const denied  = new Error('SYNTHETIC_UNAUTHORIZED');
  const service = identityAuthorizationService({
    /** @returns {void} Acepta el origen sintético sin infraestructura. */
    origin() {},
    messaging : {
      /** @returns {Object} Contexto sintético con una delegación inválida. */
      getContext : () => ({ delegation: {} }),
    },
    /** @returns {Promise<never>} Rechaza la acreditación simulada. */
    async authenticateDelegation() {
      throw denied;
    },
  });
  await assert.rejects(
    service.current('service-communication'),
    /** @param {Error} error Fallo propagado. @returns {boolean} Conserva la instancia original. */
    (error) => error === denied,
  );
});
