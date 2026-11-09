/** @file Comprueba autenticación de agentes en consumidores canónicos sin fabricar sesiones humanas. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  identityAuthorizationService,
} = require('../server/modules/identity/services/identity-authorization.service');
const { ApplicationError } = require('../server/shared/application-error');

test('la identidad vigente autentica el token y rechaza suplantación de usuario o workspace' /** @returns {Promise<void>} Verifica la separación de credenciales, contexto e identidad pública. */, async () => {
  let context     = {
    user               : { userCode: 'agent-user' },
    workspace          : 'allowed',
    agentAuthorization : {
      token             : 'fixture',
      confirmedRevision : 4,
    },
  };
  let calls       = 0;
  const service   = identityAuthorizationService({
    ApplicationError,
    messaging : {
      /** @returns {Object} Contexto acreditado. */
      getContext() {
        return context;
      },
    },
    /** @param {string} source Origen RPC. @returns {void} Valida el origen configurado. */
    origin(source) {
      assert.equal(source, 'service-communication');
    },
    /** @param {Object} auth Credencial privada. @param {string} source Origen. @returns {Promise<Object>} Principal de Security. */
    async authenticateAgent(auth, source) {
      calls++;
      assert.deepEqual(auth, {
        token             : 'fixture',
        confirmedRevision : 4,
      });
      assert.equal(source, 'service-communication');
      return {
        principal : {
          userCode   : 'agent-user',
          workspace  : 'allowed',
          workspaces : ['allowed'],
          policies   : ['communication.chat.view.workspace'],
        },
      };
    },
  });
  const principal = await service.current('service-communication');
  assert.equal(principal.userCode, 'agent-user');
  assert.equal(principal.token, undefined);
  context = {
    ...context,
    workspace : 'forbidden',
  };
  await assert.rejects(service.current('service-communication'), {
    descriptionCode : 'UNAUTHORIZED',
  });
  context = {
    ...context,
    workspace : 'allowed',
    user      : { userCode: 'victim' },
  };
  await assert.rejects(service.current('service-communication'), {
    descriptionCode : 'UNAUTHORIZED',
  });
  assert.equal(calls, 3);
});
