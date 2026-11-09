/** @file Comprueba identidad y audiencia juntas sin emitir credenciales ni compartir permisos entre llamadas. */
'use strict';
const test            = require('node:test');
const assert          = require('node:assert/strict');
const createPrincipal = require('../server/modules/agent-principal/services/agent-principal.service');
const { actionDtos }  = require('../server/contracts');

test('audiencia devuelve al publicador acreditado y conserva revisión, workspace y permisos individuales' /** @returns {Promise<void>} Valida la respuesta real y los rechazos después de revocar. */, async () => {
  let revision = 2,
    revoked    = false,
    userReads  = 0,
    technical  = false;
  const service = createPrincipal({
    repositories  : {
      user       : {
        /** @param {Object} filter Selección autorizada. @returns {Promise<Object|null>} Identidad de prueba vigente. */
        async getOne(filter) {
          userReads += 1;
          if (technical) throw Object.assign(new Error('unavailable'), { statusCode: 503 });
          if (filter.agentCode && revoked) return null;
          return {
            userCode      : filter.userCode || 'publisher',
            contactCode   : 'contact',
            agentCode     : 'agent',
            agentRevision : revision,
            userType      : filter.agentCode ? 'agent' : 'human',
            workspaces    : ['workspace'],
            groups        : [filter.agentCode ? 'publisher-policy' : 'reader-policy'],
          };
        },
      },
      workspaces : {
        /** @returns {Promise<Object>} Workspace existente. */
        async getOne() {
          return { workspaceCode: 'workspace' };
        },
      },
      group      : {
        /** @param {Object} filter Grupos del sujeto actual. @returns {Promise<Object>} Políticas propias sin uniones con otros lectores. */
        async getList(filter) {
          return {
            totalCount : 1,
            listItem   : [
              {
                groupCode : filter.groupCode.$in[0],
                policies  : filter.groupCode.$in,
              },
            ],
          };
        },
      },
      policy     : {
        /** @param {Object} filter Políticas del sujeto. @returns {Promise<Object>} Permisos vigentes. */
        async getList(filter) {
          return {
            totalCount : 1,
            listItem   : [{ identifier: filter.policyCode.$in[0] }],
          };
        },
      },
    },
    messaging     : {},
    jwt           : {},
    tokenContexts : {},
  });
  const input   = {
    agentCode           : 'agent',
    workspace           : 'workspace',
    runCode             : 'run',
    initiatedByUserCode : 'initiator',
    confirmedRevision   : 2,
    userCodes           : ['reader'],
  };
  actionDtos['agent-principal-audience'].input(input);
  const result = await service.audience(input, 'service-intelligence');
  assert.equal(result.publisher.agentRevision, 2);
  assert.equal(result.publisher.runCode, 'run');
  assert.equal(result.publisher.initiatedByUserCode, 'initiator');
  assert.deepEqual(result.publisher.policies, ['publisher-policy']);
  assert.deepEqual(result.principals[0].policies, ['reader-policy']);
  assert.equal(result.token, undefined);
  actionDtos['agent-principal-audience'].output({
    statusCode : 200,
    data       : result,
  });
  await assert.rejects(service.audience(input, 'service-communication'), { statusCode: 403 });
  await assert.rejects(
    service.audience(
      {
        ...input,
        workspace : 'another',
      },
      'service-intelligence',
    ),
    { statusCode: 403 },
  );
  userReads = 0;
  const batch = {
    audiences : Array.from(
      { length: 50 },
      /** @param {undefined} unused Valor no utilizado. @param {number} index Ejecución distinta. @returns {Object} Identidad por ejecución. */
      (unused, index) => ({
        ...input,
        runCode             : `run${index}`,
        initiatedByUserCode : `initiator${index}`,
      }),
    ),
  };
  actionDtos['agent-principal-audience-batch'].input(batch);
  const response = await service.audienceBatch(batch, 'service-intelligence');
  assert.equal(
    userReads,
    2,
    'cincuenta ejecuciones consultan una vez al agente y una vez al lector',
  );
  for (let index = 0; index < 50; index += 1) {
    assert.equal(response.items[index].allowed, true);
    assert.equal(response.items[index].publisher.runCode, `run${index}`);
    assert.equal(response.items[index].publisher.initiatedByUserCode, `initiator${index}`);
  }
  actionDtos['agent-principal-audience-batch'].output({
    statusCode : 200,
    data       : response,
  });
  const mixed = await service.audienceBatch(
    {
      audiences : [
        input,
        {
          ...input,
          confirmedRevision : 1,
        },
        {
          ...input,
          workspace : 'another',
        },
      ],
    },
    'service-intelligence',
  );
  assert.deepEqual(
    mixed.items.map(
      /** @param {Object} item Resultado. @returns {boolean} Acceso independiente. */
      (item) => item.allowed,
    ),
    [true, false, false],
  );
  technical = true;
  await assert.rejects(service.audienceBatch(batch, 'service-intelligence'), { statusCode: 503 });
  technical = false;
  revision = 3;
  assert.equal(
    (await service.audienceBatch(batch, 'service-intelligence')).items[0].allowed,
    false,
  );
  await assert.rejects(service.audience(input, 'service-intelligence'), { statusCode: 403 });
  revision = 2;
  revoked = true;
  await assert.rejects(service.audience(input, 'service-intelligence'), { statusCode: 403 });
  assert.equal(
    (await service.audienceBatch(batch, 'service-intelligence')).items[0].allowed,
    false,
  );
});
