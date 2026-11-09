/** @file El cierre propio no exige permisos administrativos ni concede acceso a sesiones ajenas. */
'use strict';
const test                 = require('node:test');
const assert               = require('node:assert/strict');
const { ApplicationError } = require('../server/shared/application-error');
const sessionPolicy        = require('../server/modules/session/policies/session.policy');
const {
  sessionRevocationWorkflowService,
} = require('../server/modules/session/services/session-revocation-workflow.service');

test('una cuenta sin perfiles cierra sólo su sesión autenticada y el administrador conserva su alcance', /** @returns {Promise<void>} Prueba la política real y los filtros que llegan al repositorio. */ async () => {
  const context  = {
    idTransaction : 'logout',
    idSession     : 'session-id',
    sessionCode   : 'current',
    workspace     : 'workspace',
    user          : {
      userCode : 'owner',
      userType : 'human',
    },
    policies      : [],
  };
  const calls    = [];
  const workflow = sessionRevocationWorkflowService({
    ApplicationError,
    sessionPolicy,
    sessionScopes     : sessionPolicy.trustedScopes,
    sessionState      : {},
    messaging         : {
      /** @returns {Object} Principal autenticado por el transporte. */ getContext() {
        return context;
      },
    },
    logger            : { /** @returns {void} Evita efectos de registro en esta prueba. */ error() {} },
    sessionRepository : {
      /** @param {Object} filter Filtro acreditado. @param {symbol|string} scope Alcance interno. @returns {Promise<Object>} Cierre confirmado. */
      async close(filter, scope) {
        calls.push({
          filter,
          scope,
        });
        return { active: false };
      },
    },
  });
  assert.equal((await workflow.delete({ sessionCode: 'current' })).active, false);
  assert.equal(calls[0].scope, sessionPolicy.trustedScopes.guest);
  const filter = JSON.stringify(calls[0].filter);
  assert(filter.includes('"sessionCode":"current"'));
  assert(filter.includes('"userCode":"owner"'));
  await assert.rejects(workflow.delete({ sessionCode: 'foreign' }), { statusCode: 403 });
  await assert.rejects(workflow.delete({ sessionCode: 'current' }, 'global'), { statusCode: 403 });
  context.idSession = '';
  await assert.rejects(workflow.delete({ sessionCode: 'current' }), { statusCode: 403 });
  assert.equal(calls.length, 1);
  context.idSession = 'session-id';
  context.policies = ['security.session.delete.global'];
  await workflow.delete({ sessionCode: 'foreign' }, 'global');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].scope, 'global');
});
