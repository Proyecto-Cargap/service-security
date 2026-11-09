/** @file Compatibilidad de proyecciones de Security y aislamiento de estado de sus fachadas con colaboradores mínimos. */
'use strict';
const test                = require('node:test');
const assert              = require('node:assert/strict');
const { publicPage }      = require('../server/shared/public-record');
const { groupPresenter }  = require('../server/modules/group/presenters/group.presenter');
const { policyPresenter } = require('../server/modules/policy/presenters/policy.presenter');
const {
  workspacesPresenter,
} = require('../server/modules/workspaces/presenters/workspaces.presenter');
const {
  sessionDetailPresenter,
} = require('../server/modules/session/presenters/session-detail.presenter');
const createGroup     = require('../server/modules/group/services/group.service');
const createPolicy    = require('../server/modules/policy/services/policy.service');
const createWorkspace = require('../server/modules/workspaces/services/workspaces.service');

/**
 * Preserva campos públicos y ausencia sin permitir que aparezcan metadatos nuevos en la frontera.
 * @returns {void} Finaliza al comprobar recursos, páginas, imágenes y fichas de sesiones.
 */
function verifyPresenters() {
  for (const [presenter, codeField] of [
    [groupPresenter, 'groupCode'],
    [policyPresenter, 'policyCode'],
    [workspacesPresenter, 'workspaceCode'],
  ]) {
    const source = {
      [codeField]    : 'code',
      workspace      : 'w',
      userCreate     : 'u',
      userAssigned   : '',
      futurePrivate  : true,
      pictureCleanup : ['old'],
    };
    const value  = presenter(source);
    assert.equal(value[codeField], 'code');
    assert.equal(value.futurePrivate, undefined);
    assert.equal(value.pictureCleanup, undefined);
    assert.equal(presenter(null), null);
    const page = publicPage(
      {
        pagination : {
          total        : 1,
          page         : 1,
          perPage      : 20,
          privateCount : 1,
        },
        items      : [source],
      },
      presenter,
    );
    assert.deepEqual(page.pagination, {
      total   : 1,
      page    : 1,
      perPage : 20,
    });
    assert.deepEqual(page.items, [value]);
  }
  const picture   = {
    id          : 'file',
    name        : 'image',
    mimeType    : 'image/webp',
    url         : '/files/public/image',
    size        : 1,
    visibility  : 'public',
    sizes       : ['200'],
    storagePath : 'private-fixture',
  };
  const workspace = workspacesPresenter({
    workspaceCode : 'w',
    pictureFile   : picture,
  });
  assert.equal(workspace.pictureFile.storagePath, undefined);
  assert.equal(workspace.pictureFile.url, picture.url);
  workspace.pictureFile.sizes.push('500');
  assert.deepEqual(picture.sizes, ['200']);
  const detail = sessionDetailPresenter({
    record        : {
      sessionCode : 's',
      userCode    : 'u',
      token       : 'private-fixture',
      policies    : ['private'],
      active      : true,
      expiration  : Date.now() / 1000 + 600,
    },
    account       : {
      user     : ' user@example.invalid ',
      password : 'private-fixture',
    },
    workspaceName : 'Workspace',
    roleName      : 'Role',
    profile       : null,
  });
  assert.equal(detail.user, 'user@example.invalid');
  assert.equal(detail.state, 'active');
  assert.equal(detail.profile, null);
  assert.equal(JSON.stringify(detail).includes('private-fixture'), false);
  assert.equal(Object.hasOwn(detail, 'policies'), false);
}

/**
 * Verifica que los casos de consulta no requieren escritura ni comparten estado entre solicitudes.
 * @returns {Promise<void>} Finaliza al comprobar grupos, políticas y workspaces con el mismo comportamiento.
 */
async function verifyStateIsolation() {
  for (const [name, factory, codeField] of [
    ['group', createGroup, 'groupCode'],
    ['policy', createPolicy, 'policyCode'],
    ['workspaces', createWorkspace, 'workspaceCode'],
  ]) {
    /** @param {Object} filter Identidad solicitada por esta consulta.
     * @returns {Promise<Object>} Registro mínimo utilizado únicamente por la consulta.
     */
    async function getOne(filter) {
      return {
        [codeField]    : filter[codeField],
        pictureCleanup : [],
      };
    }
    const dependencies = {
      repositories : { [name]: { getOne } },
      messaging    : {},
    };
    const first        = factory(dependencies);
    const second       = factory(dependencies);
    assert.equal((await first.getOne({ [codeField]: 'first' }))[codeField], 'first');
    assert.equal((await second.getOne({ [codeField]: 'second' }))[codeField], 'second');
  }
}

test(
  'las proyecciones de Security conservan referencias públicas y excluyen estado interno',
  verifyPresenters,
);
test(
  'las consultas separadas admiten repositorios mínimos y aíslan el estado por instancia',
  verifyStateIsolation,
);
