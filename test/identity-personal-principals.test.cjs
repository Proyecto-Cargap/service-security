/** @file Autorización diferida personal: membresías actuales, revocación y ausencia de permisos administrativos. */
'use strict';
const test = require('node:test'),
  assert   = require('node:assert/strict');
const {
  identityPersonalPrincipalsService,
} = require('../server/modules/identity/services/identity-personal-principals.service');
const { readAll } = require('../server/shared/bounded-read');
test('las capacidades personales se revalidan sin sesión y leen sus políticas sin paginación administrativa', /** @returns {Promise<void>} Comprueba filtros y revocación sin MongoDB ni credenciales. */ async () => {
  let active    = true,
    policyPages = 0;
  const service = identityPersonalPrincipalsService({
    /** @param {string} source Origen acreditado. @returns {void} Rechaza fuentes externas. */ origin(
      source,
    ) {
      assert.equal(source, 'service-connect');
    },
    /** @param {string[]} values Códigos explícitos. @returns {string[]} Propietarios seleccionados. */ codes(
      values,
    ) {
      return values;
    },
    /** @returns {Object} Filtro de persona activa. */ active() {
      return {
        state  : 'active',
        erased : false,
      };
    },
    users           : {
      /** @param {Object} filter Propietario. @returns {Promise<Object|null>} Ausencia real tras revocación. */ async getOne(
        filter,
      ) {
        assert.equal(filter.userCode, 'owner');
        return active
          ? {
              groups     : ['g1'],
              workspaces : ['workspace-1'],
            }
          : null;
      },
    },
    workspaces      : {
      /** @param {Object} filter Membresías. @returns {Promise<Object>} Workspaces todavía existentes. */ async getList(
        filter,
      ) {
        assert.deepEqual(filter.workspaceCode, { $in: ['workspace-1'] });
        return {
          listItem   : [{ workspaceCode: 'workspace-1' }],
          totalCount : 1,
        };
      },
    },
    groups          : {
      /** @param {Object} filter Grupos vigentes. @returns {Promise<Object[]>} Referencias mínimas. */
      async readAccess(filter) {
        assert.deepEqual(filter.workspace.$in, ['allWorkspaces', 'workspace-1']);
        return [{ policies: ['personal'] }];
      },
    },
    policies        : {
      /** @param {Object} filter Condiciones de autorización. @returns {Promise<Object[]>} Políticas actuales sin conteo. */
      async readAccess(filter) {
        assert.equal(filter.active, true);
        assert(filter.identifier.$regex.test('connect.mailbox.view.owner'));
        assert(!filter.identifier.$regex.test('connect.settings.view.global'));
        policyPages++;
        return [
          ...Array.from(
            { length: 100 },
            /** @returns {Object} Permiso repetido que se deduplica. */
            () => ({ identifier: 'documents.personal.view.owner' }),
          ),
          { identifier: 'connect.mailbox.view.owner' },
          { identifier: 'connect.settings.view.global' },
        ];
      },
    },
    userScopes      : { guest: {} },
    workspaceScopes : { guest: {} },
    groupScopes     : { guest: {} },
    policyScopes    : { guest: {} },
    readAll,
  });
  const result  = await service.personalPrincipals({ userCodes: ['owner'] }, 'service-connect');
  assert.equal(policyPages, 1);
  assert.deepEqual(result.items, [
    {
      userCode : 'owner',
      policies : ['documents.personal.view.owner', 'connect.mailbox.view.owner'],
    },
  ]);
  active = false;
  assert.deepEqual(await service.personalPrincipals({ userCodes: ['owner'] }, 'service-connect'), {
    items : [],
  });
});
