/** @file Regresión de identidad de agentes sobre puertos reales: idempotencia, revisiones, revocación y separación de sesiones humanas. */
'use strict';
const assert = require('node:assert/strict');

/**
 * Ejecuta los casos de agentes con persistencia real recibida y un contrato remoto de Directory controlado.
 * @param {Object} options Repositorios, mensajería contextual y marcador interno de workspaces.
 * @returns {Promise<void>} Finaliza al probar que una revisión revocada no puede reactivarse ni reutilizar su credencial.
 */
async function verifyAgentLifecycle({ repositories, messaging, workspaceScope }) {
  await repositories.workspaces.create(
    {
      workspaceCode : 'agent-w',
      name          : 'Agent workspace',
      workspace     : 'allWorkspaces',
      userCreate    : '',
      userAssigned  : '',
    },
    workspaceScope,
  );
  const context      = {
    user          : { userCode: 'admin' },
    workspace     : 'agent-w',
    policies      : [
      'intelligence.agent.create.global',
      'intelligence.agent.update.global',
      'intelligence.agent.delete.global',
    ],
    idTransaction : 'agent-contract',
  };
  let contactCalls   = 0;
  let authorityCalls = 0;
  /**
   * Acredita el contrato remoto canónico sin efectos ni dependencia de otro servicio desplegado.
   * @param {string} service Servicio responsable de la capacidad remota.
   * @param {string} action Acción canónica cuya entrada se verifica.
   * @param {Object} data Datos de dominio, sin SDK ni selección de consumidor.
   * @returns {Promise<Object>} Identidad de contacto o confirmación de la revisión vigente.
   */
  async function request(service, action, data) {
    if (service === 'service-directory' && action === 'agent-contact-provision') {
      assert.equal(data.agentCode, 'contract-agent');
      contactCalls++;
      return {
        statusCode : 200,
        data       : {
          userCode    : 'contract-agent-user',
          contactCode : 'contract-agent-user',
        },
      };
    }
    assert.equal(service, 'service-intelligence');
    assert.equal(action, 'agent-principal-state');
    assert.equal(data.agentCode, 'contract-agent');
    authorityCalls++;
    return {
      statusCode : 200,
      data       : { active: true },
    };
  }
  const service = require('../../server/modules/agent-principal/services/agent-principal.service')({
    repositories,
    messaging         : {
      ...messaging,
      request,
    },
    jwt               : require('jsonwebtoken'),
    tokenSecret       : 'fixture-local-agent-contract',
    tokenCryptography : require('../../server/adapters/security/token-cryptography'),
    tokenContexts     : require('../../server/adapters/security/token-contexts').tokenContexts({
      PLATFORM_ID : 'fixture',
      ENV_NAME    : 'test',
    }),
  });
  const input   = {
    agentCode  : 'contract-agent',
    workspace  : 'agent-w',
    revision   : 1,
    name       : 'Agent fixture',
    groups     : [],
    workspaces : ['agent-w'],
    validity   : Date.now() + 600000,
  };
  /** @returns {Promise<void>} Comprueba todas las transiciones con el contexto administrativo explícito. */
  async function transitions() {
    const identity = await service.provision(input, 'service-intelligence');
    assert.equal(identity.state, 'inactive');
    assert.equal(identity.actorType, 'agent');
    assert.deepEqual(await service.provision(input, 'service-intelligence'), identity);
    assert.equal(contactCalls, 1);
    await assert.rejects(
      service.provision(
        {
          ...input,
          name : 'Conflicting name',
        },
        'service-intelligence',
      ),
      { statusCode: 409 },
    );
    assert.equal(contactCalls, 1);
    const activated = await service.activate(
      {
        agentCode         : input.agentCode,
        workspace         : input.workspace,
        revision          : 1,
        confirmedRevision : 1,
      },
      'service-intelligence',
    );
    assert.equal(activated.state, 'active');
    const credential    = await service.resolve(
      {
        agentCode         : input.agentCode,
        workspace         : input.workspace,
        runCode           : 'contract-run',
        confirmedRevision : 1,
      },
      'service-intelligence',
    );
    const authenticated = await service.authenticate(
      { token: credential.token },
      'service-apigateway',
    );
    assert.equal(authenticated.principal.agentRevision, 1);
    assert.equal(authenticated.principal.userCode, identity.userCode);
    assert.equal(authorityCalls, 1);
    await service.revoke(
      {
        agentCode : input.agentCode,
        workspace : input.workspace,
        revision  : 1,
      },
      'service-intelligence',
    );
    await assert.rejects(service.authenticate({ token: credential.token }, 'service-apigateway'), {
      statusCode : 403,
    });
    await assert.rejects(
      service.activate(
        {
          agentCode         : input.agentCode,
          workspace         : input.workspace,
          revision          : 1,
          confirmedRevision : 1,
        },
        'service-intelligence',
      ),
      { statusCode: 409 },
    );
    await assert.rejects(service.provision(input, 'service-intelligence'), { statusCode: 409 });
    const updated = await service.provision(
      {
        ...input,
        revision : 2,
      },
      'service-intelligence',
    );
    assert.equal(updated.userCode, identity.userCode);
    assert.equal(updated.revision, 2);
    assert.equal(updated.state, 'inactive');
    await service.activate(
      {
        agentCode         : input.agentCode,
        workspace         : input.workspace,
        revision          : 2,
        confirmedRevision : 2,
      },
      'service-intelligence',
    );
    await assert.rejects(service.authenticate({ token: credential.token }, 'service-apigateway'), {
      statusCode : 401,
    });
    await assert.rejects(
      service.activate(
        {
          agentCode         : input.agentCode,
          workspace         : input.workspace,
          revision          : 1,
          confirmedRevision : 1,
        },
        'service-intelligence',
      ),
      { statusCode: 409 },
    );
    await assert.rejects(
      service.provision(
        {
          ...input,
          revision : 3,
        },
        'service-documents',
      ),
      { statusCode: 403 },
    );
    assert.equal(contactCalls, 2);
    const sessions = await repositories.session.getList(
      { userCode: identity.userCode },
      {},
      0,
      10,
      '',
      require('../../server/modules/session/policies/session.policy').trustedScopes.guest,
    );
    assert.equal(sessions.totalCount, 0);
  }
  await messaging.runWithContext(context, transitions);
}

module.exports = { verifyAgentLifecycle };
