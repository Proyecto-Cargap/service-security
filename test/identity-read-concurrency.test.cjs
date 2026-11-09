/** @file Identidad respeta la transacción heredada y revalida las revocaciones en cada lectura. */
'use strict';
const test                 = require('node:test');
const assert               = require('node:assert/strict');
const { ApplicationError } = require('../server/shared/application-error');
const {
  identityAuthorizationService,
} = require('../server/modules/identity/services/identity-authorization.service');
test(
  'identidad realiza una sola lectura por solicitud y revalida la cuenta',
  { timeout: 1000 },
  /** @returns {Promise<void>} El puerto rechaza operaciones simultáneas y la segunda lectura detecta revocación. */
  async () => {
    let active    = true;
    let reads     = 0;
    const service = identityAuthorizationService({
      ApplicationError,
      /** @returns {void} Origen acreditado del caso sintético. */
      origin() {},
      messaging     : {
        /** @returns {Object} Identidad técnica mínima. */ getContext() {
          return {
            user        : { userCode: 'u' },
            sessionCode : 's',
            workspace   : 'w',
          };
        },
      },
      authorization : {
        /** @param {Object} input Identidad acreditada. @returns {Promise<Object>} Snapshot vigente sin reutilizar autorizaciones anteriores. */
        async read(input) {
          assert.equal(input.userCode, 'u');
          assert.equal(input.sessionCode, 's');
          assert(input.now > 0);
          reads++;
          return {
            user       : active
              ? {
                  userCode   : 'u',
                  userType   : 'human',
                  workspaces : ['w'],
                }
              : null,
            session    : {
              activeWorkspace : 'w',
              workspaces      : ['w'],
              policies        : ['read'],
            },
            workspaces : ['w'],
          };
        },
      },
    });
    assert.deepEqual(await service.current('service-platform'), {
      userCode   : 'u',
      workspace  : 'w',
      workspaces : ['w'],
      policies   : ['read'],
    });
    assert.equal(reads, 1);
    active = false;
    await assert.rejects(service.current('service-platform'), { statusCode: 401 });
    assert.equal(reads, 2);
  },
);
