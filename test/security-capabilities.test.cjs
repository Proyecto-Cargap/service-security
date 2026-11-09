/** @file Pruebas de interfaces mínimas después de separar autorización, validaciones y credenciales de Security. */
'use strict';
const test                 = require('node:test');
const assert               = require('node:assert/strict');
const { ApplicationError } = require('../server/shared/application-error');
const {
  identityAuthorizationService,
} = require('../server/modules/identity/services/identity-authorization.service');
const {
  groupValidationService,
} = require('../server/modules/group/services/group-validation.service');
const {
  agentCredentialsService,
} = require('../server/modules/agent-principal/services/agent-credentials.service');

/**
 * Acredita referencias completas con lectores de una sola operación, sin escrituras, red ni otros servicios.
 * @returns {Promise<void>} Finaliza al verificar una instantánea completa y una denegación si desaparece el espacio activo.
 */
async function verifyMinimalIdentity() {
  const assigned = [];
  for (let index = 0; index < 231; index++) assigned.push(`w${index}`);
  const batches = [];
  let available = true;
  /** @param {string} source Origen ya autenticado por el transporte.
   * @returns {void} Exige la misma autoridad para cada emisor permitido.
   */
  function origin(source) {
    assert.equal(source, 'service-platform');
  }
  /** @returns {Object} Contexto mínimo de una sesión humana. */
  function getContext() {
    return {
      user        : { userCode: 'u' },
      sessionCode : 's',
      workspace   : 'w230',
    };
  }
  /** @returns {Promise<Object>} Cuenta de aplicación sin métodos ni identificadores técnicos. */
  async function user() {
    return {
      userCode   : 'u',
      userType   : 'human',
      workspaces : assigned,
    };
  }
  /** @returns {Promise<Object>} Sesión vigente con la intersección de membresías autorizadas. */
  async function session() {
    return {
      activeWorkspace : 'w230',
      workspaces      : assigned,
      policies        : ['read'],
    };
  }
  const service = identityAuthorizationService({
    ApplicationError,
    origin,
    messaging     : { getContext },
    authorization : {
      /** @returns {Promise<Object>} Puerto mínimo de lectura sin truncar las membresías autorizadas. */
      async read() {
        batches.push('snapshot');
        return {
          user       : await user(),
          session    : await session(),
          workspaces : assigned.filter(
            /** @param {string} code Espacio sintético. @returns {boolean} Simula su revocación. */
            (code) => available || code !== 'w230',
          ),
        };
      },
    },
  });
  const result  = await service.current('service-platform');
  assert.equal(result.workspaces.length, 231);
  assert.equal(batches.length, 1);
  assert.equal(result.workspace, 'w230');
  available = false;
  await assert.rejects(service.current('service-platform'), { statusCode: 403 });
}

/**
 * Comprueba una nueva implementación de lectura de políticas sin servicios, repositorios o mensajería generales.
 * @returns {Promise<void>} Finaliza al acreditar lectura sólo de nuevas asociaciones y errores sin efectos adicionales.
 */
async function verifyMinimalGroupValidation() {
  const requested = [];
  /** @param {Object} filter Política nueva que se debe acreditar.
   * @returns {Promise<Object|null>} Registro visible o ausencia, conservando el contrato de lectura mínimo.
   */
  async function readPolicy(filter) {
    requested.push(filter.policyCode);
    return filter.policyCode === 'new' ? { policyCode: 'new' } : null;
  }
  const service = groupValidationService({
    ApplicationError,
    readPolicy,
  });
  assert.equal(service.validName(' Group '), 'Group');
  assert.deepEqual(await service.validPolicies(['previous', 'new'], ['previous']), [
    'previous',
    'new',
  ]);
  assert.deepEqual(requested, ['new']);
  await assert.rejects(service.validPolicies(['new', 'new']), { statusCode: 400 });
  assert.deepEqual(requested, ['new']);
  await assert.rejects(service.validPolicies(['missing']), { statusCode: 400 });
}

/**
 * Demuestra que la emisión y validación sólo necesitan firmante y lector de principal, sin repositorios.
 * @returns {Promise<void>} Finaliza al comprobar credencial, relectura y rechazo de una identidad que cambió.
 */
async function verifyMinimalAgentCredentials() {
  const revisions = [];
  let revision    = 2;
  /** @param {string} agentCode Agente solicitado por las afirmaciones firmadas.
   * @param {string} workspace Espacio autorizado por el principal actual.
   * @param {string} runCode Ejecución solicitada.
   * @param {string} initiatedByUserCode Autor humano de la ejecución.
   * @param {number|undefined} confirmedRevision Prueba opcional aportada por una autoridad acreditada.
   * @returns {Promise<Object>} Principal mínimo y fresco de esta ejecución.
   */
  async function current(agentCode, workspace, runCode, initiatedByUserCode, confirmedRevision) {
    revisions.push(confirmedRevision);
    return {
      agentCode,
      userCode      : 'u',
      agentRevision : revision,
      workspace,
      runCode,
      initiatedByUserCode,
    };
  }
  const { origin } =
    require('../server/modules/agent-principal/policies/agent-input.policy').agentInputPolicy({
      ApplicationError,
    });
  /** @returns {string} Clave exclusiva de la prueba; nunca lee el entorno global. */
  function secret() {
    return 'fixture-minimal-agent-key';
  }
  const service = agentCredentialsService({
    ApplicationError,
    current,
    origin,
    secret,
    jwt                      : require('jsonwebtoken'),
    agentRevisionAttestation :
      require('../server/modules/agent-principal/policies/agent-revision.policy')
        .agentRevisionAttestation,
    tokenContexts            : {
      agent_execution : {
        issuer   : 'urn:fixture:security',
        audience : 'urn:fixture:agent_execution',
      },
    },
  });
  const issued  = await service.resolve(
    {
      agentCode           : 'a',
      workspace           : 'w',
      runCode             : 'run',
      initiatedByUserCode : 'human',
      confirmedRevision   : 2,
    },
    'service-intelligence',
  );
  assert.equal(typeof issued.token, 'string');
  assert.equal(
    (await service.authenticate({ token: issued.token }, 'service-apigateway')).principal.userCode,
    'u',
  );
  assert.deepEqual(revisions, [2, undefined]);
  revision = 3;
  await assert.rejects(service.authenticate({ token: issued.token }, 'service-apigateway'), {
    statusCode : 401,
  });
}

test(
  'la autorización humana funciona sólo con lectores mínimos y referencias completas',
  verifyMinimalIdentity,
);
test(
  'la validación de grupos necesita únicamente la lectura de una política',
  verifyMinimalGroupValidation,
);
test(
  'las credenciales de agentes admiten un lector mínimo sin persistencia',
  verifyMinimalAgentCredentials,
);
