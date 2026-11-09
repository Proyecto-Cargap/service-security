/** @file Permisos frescos para tareas diferidas: membresía revocada, lectura interna completa y separación entre destinatarios. */
'use strict';
const test                = require('node:test');
const assert              = require('node:assert/strict');
const { identityService } = require('../server/modules/identity/services/identity.service');

test('principales vigentes leen todas las políticas sin páginas administrativas y nunca reutilizan sesiones o permisos de otro colaborador' /** @returns {Promise<void>} Comprueba el contrato mínimo y la revocación en cada consulta. */, async () => {
  let revoked     = false;
  const seen      = [];
  const effective = Array.from(
    { length: 101 },
    /** @param {unknown} value Elemento inicial. @param {number} index Identidad secuencial. @returns {Object} Política pública activa. */
    (value, index) => ({ identifier: 'customer.activity.view.' + index }),
  );
  const service   = identityService({
    messaging  : {},
    sessions   : {},
    users      : {
      /** @param {Object} query Criterios internos. @returns {Promise<Object|null>} Miembro solicitado o baja vigente. */
      async getOne(query) {
        assert.equal(query.workspaces, 'workspace-a');
        return revoked || query.userCode !== 'alice'
          ? null
          : {
              userCode : 'alice',
              groups   : ['group-a'],
              password : 'private',
            };
      },
    },
    workspaces : {
      /** @returns {Promise<Object>} Workspace existente. */
      async getOne() {
        return { workspaceCode: 'workspace-a' };
      },
    },
    groups     : {
      /** @param {Object} query Criterios internos. @returns {Promise<Object>} Membresías del usuario. */
      async readAccess(query) {
        assert.deepEqual(query.groupCode.$in, ['group-a']);
        return [
          {
            groupCode : 'group-a',
            policies  : ['policy-a'],
          },
        ];
      },
    },
    policies   : {
      /** @param {Object} query Criterios internos. @param {Object} sort Orden. @param {number} page Página desde cero. @param {number} perPage Tamaño. @returns {Promise<Object>} Página realista de políticas activas. */
      async readAccess(query) {
        assert.equal(query.active, true);
        seen.push(true);
        return effective;
      },
    },
  });
  const result    = await service.principals(
    {
      workspace : 'workspace-a',
      userCodes : ['alice', 'bob'],
    },
    'service-customer',
  );
  assert.deepEqual(seen, [true]);
  assert.equal(result.items.length, 1);
  assert.deepEqual(Object.keys(result.items[0]), ['userCode', 'workspace', 'policies']);
  assert.equal(result.items[0].policies.length, 101);
  revoked = true;
  assert.deepEqual(
    await service.principals(
      {
        workspace : 'workspace-a',
        userCodes : ['alice'],
      },
      'service-customer',
    ),
    { items: [] },
  );
  await assert.rejects(
    service.principals(
      {
        workspace : 'workspace-a',
        userCodes : ['alice'],
      },
      'untrusted',
    ),
    { statusCode: 403 },
  );
});

test('principales por cuenta conservan espacios separados y direcciones privadas restringidas' /** @returns {Promise<void>} No une facultades de contextos distintos ni expone correos a Projects. */, async () => {
  let revoked   = false;
  const service = identityService({
    messaging  : {},
    sessions   : {},
    users      : {
      /** @param {Object} query Cuenta y membresía. @returns {Promise<Object|null>} Cuenta activa con datos privados sintéticos. */
      async getOne(query) {
        return revoked
          ? null
          : {
              userCode   : query.userCode,
              user       : 'client@example.test',
              workspaces : ['alpha', 'beta'],
              groups     : ['group-a'],
              password   : 'never-exposed',
            };
      },
    },
    workspaces : {
      /** @returns {Promise<Object>} Workspace vigente. */ async getOne() {
        return {};
      },
    },
    groups     : {
      /** @returns {Promise<Object>} Grupo del usuario. */
      async readAccess() {
        return [{ policies: ['policy-a'] }];
      },
    },
    policies   : {
      /** @param {Object} query Workspace de la consulta. @returns {Promise<Object>} Permiso exclusivo de cada contexto. */
      async readAccess(query) {
        return [
          {
            identifier :
              query.workspace.$in[0] === 'alpha'
                ? 'projects.ticket.view.global'
                : 'projects.ticket.update.global',
          },
        ];
      },
    },
  });
  const result  = await service.userPrincipals({ userCodes: ['client'] }, 'service-projects');
  assert.deepEqual(
    result.items.map(
      /** @param {Object} principal Contexto vigente. @returns {Object} Campos autorizados de entrega. */
      (principal) => principal,
    ),
    [
      {
        userCode  : 'client',
        workspace : 'alpha',
        policies  : ['projects.ticket.view.global'],
      },
      {
        userCode  : 'client',
        workspace : 'beta',
        policies  : ['projects.ticket.update.global'],
      },
    ],
  );
  await assert.rejects(service.deliveryAddresses({ userCodes: ['client'] }, 'service-projects'), {
    statusCode : 403,
  });
  assert.deepEqual(await service.deliveryAddresses({ userCodes: ['client'] }, 'service-platform'), {
    items : [
      {
        userCode : 'client',
        email    : 'client@example.test',
      },
    ],
  });
  revoked = true;
  assert.deepEqual(await service.userPrincipals({ userCodes: ['client'] }, 'service-platform'), {
    items : [],
  });
  assert.deepEqual(await service.deliveryAddresses({ userCodes: ['client'] }, 'service-platform'), {
    items : [],
  });
});
