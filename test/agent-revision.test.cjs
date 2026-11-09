/** @file Autorización uniforme de acreditaciones de revisión y representación de principales para todos los servicios permitidos. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  agentRevisionAttestation,
} = require('../server/modules/agent-principal/policies/agent-revision.policy');
const createPrincipal   = require('../server/modules/agent-principal/services/agent-principal.service');
const { tokenContexts } = require('../server/adapters/security/token-contexts');

/**
 * Acredita disponibilidad mediante la misma lectura autoritativa y las mismas consultas por emisor.
 * @returns {Promise<void>} Finaliza al comprobar acceso, denegación y ausencia sin ampliar privilegios.
 */
async function verifyRevisionAuthorization() {
  const queries = [];
  const started = Date.now();
  const user    = {
    userCode      : 'u',
    contactCode   : 'c',
    agentCode     : 'a',
    userType      : 'agent',
    agentRevision : 2,
    state         : 'active',
    erased        : false,
    workspaces    : ['w'],
    groups        : [],
  };
  const claims  = {
    purpose             : 'agent_execution',
    userCode            : 'u',
    agentCode           : 'a',
    agentRevision       : 2,
    workspace           : 'w',
    runCode             : 'run',
    initiatedByUserCode : '',
    exp                 : 1900000000,
  };
  /** @param {Object} filter Selección canónica del usuario del agente.
   * @returns {Promise<Object>} Cuenta vigente sin variar por servicio solicitante.
   */
  async function getUser(filter) {
    assert.equal(Number.isFinite(filter.validity.$gt), true);
    assert(filter.validity.$gt >= started && filter.validity.$gt <= Date.now());
    const normalized = structuredClone(filter);
    normalized.validity.$gt = 'verified-current-time';
    queries.push({
      kind   : 'user',
      filter : normalized,
    });
    return user;
  }
  /** @param {Object} filter Selección del workspace vigente.
   * @returns {Promise<Object>} Workspace autorizado de la cuenta.
   */
  async function getWorkspace(filter) {
    queries.push({
      kind : 'workspace',
      filter,
    });
    return { workspaceCode: 'w' };
  }
  /** @param {Object} filter Selección de grupos o políticas.
   * @returns {Promise<Object>} Conjunto vacío completo; no reúne permisos de otros sujetos.
   */
  async function getList(filter) {
    queries.push({
      kind : 'list',
      filter,
    });
    return {
      totalCount : 0,
      listItem   : [],
    };
  }
  /** @returns {Object} Credencial previamente verificada por el puerto de firma inyectado. */
  function verify() {
    return claims;
  }
  /** @param {string} service Destinatario autoritativo.
   * @param {string} action Acción canónica de revisión.
   * @param {Object} data Identificador y revisión consultados.
   * @returns {Promise<Object>} Disponibilidad de la misma revisión para cualquier solicitante.
   */
  async function request(service, action, data) {
    queries.push({
      kind : 'readiness',
      service,
      action,
      data,
    });
    return {
      statusCode : 200,
      data       : { active: true },
    };
  }
  const service = createPrincipal({
    repositories  : {
      user       : { getOne: getUser },
      workspaces : { getOne: getWorkspace },
      group      : { getList },
      policy     : { getList },
    },
    messaging     : { request },
    jwt           : { verify },
    tokenSecret   : 'fixture-only',
    tokenContexts : tokenContexts({
      PLATFORM_ID : 'fixture',
      ENV_NAME    : 'test',
    }),
  });
  let canonical;
  for (const source of [
    'service-apigateway',
    'service-communication',
    'service-documents',
    'service-intelligence',
  ]) {
    queries.length = 0;
    const result = await service.authenticate({ token: 'verified-by-port' }, source);
    assert.equal(result.principal.agentRevision, 2);
    if (!canonical) canonical = structuredClone(queries);
    else assert.deepEqual(queries, canonical);
  }
  let accredited;
  for (const source of ['service-communication', 'service-intelligence']) {
    queries.length = 0;
    const result = await service.authenticate(
      {
        token             : 'verified-by-port',
        confirmedRevision : 2,
      },
      source,
    );
    assert.equal(result.principal.agentRevision, 2);
    if (!accredited) accredited = structuredClone(queries);
    else assert.deepEqual(queries, accredited);
  }
  queries.length = 0;
  await assert.rejects(
    service.authenticate(
      {
        token             : 'verified-by-port',
        confirmedRevision : 2,
      },
      'service-documents',
    ),
    { statusCode: 403 },
  );
  assert.deepEqual(queries, []);
  /** @returns {number|undefined} Acreditación inválida que no debe llegar a los repositorios. */
  function staleRevision() {
    return agentRevisionAttestation({ confirmedRevision: 1 }, 'service-intelligence', 2);
  }
  assert.throws(staleRevision, { statusCode: 403 });
}

test(
  'la acreditación de revisión restringe permisos y conserva consultas canónicas entre servicios',
  verifyRevisionAuthorization,
);
