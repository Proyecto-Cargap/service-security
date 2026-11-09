/** @file Compatibilidad de entradas de todos los dominios de Security con web, Gateway e Intelligence. */
'use strict';
const test                     = require('node:test');
const assert                   = require('node:assert/strict');
const { actionDtos, manifest } = require('../server/contracts');

const INPUTS = {
  'session-own-access-get'           : {},
  'agent-principal-audience-batch'   : {
    audiences : [
      {
        agentCode         : 'a',
        workspace         : 'w',
        runCode           : 'run',
        confirmedRevision : 1,
        userCodes         : ['u'],
      },
    ],
  },
  'session-own-profile-get'          : {},
  'session-own-profile-picture-read' : { size: '200' },
  'session-profile-picture-read'     : {
    code : 's',
    size : '100',
  },
  'session-get-one'                  : { code: 's' },

  'session-create'                   : {
    user          : 'user@example.invalid',
    password      : 'Password123!',
    workspaceCode : 'w',
  },
  'session-get-list'                 : {
    status   : 'active',
    page     : '1',
    perPage  : 20,
    search   : 'Name',
    roleCode : 'r|other',
    from     : '',
    to       : '1900000000000',
    sort     : 'start',
    order    : 'desc',
  },
  'session-delete'                   : {
    code  : 's',
    scope : 'workspace',
  },
  'session-renovate'                 : { code: 'signed-fixture-token' },
  'session-update'                   : {
    code          : 's',
    workspaceCode : 'w',
  },
  'session-delete-by-token'          : { code: 'signed-fixture-token' },

  'group-create'                     : {
    name      : 'Group',
    policies  : ['p'],
    workspace : 'w',
  },
  'group-update'                     : {
    code     : 'g',
    name     : 'Group',
    policies : [],
  },
  'group-get-one'                    : { code: 'g' },
  'group-get-list'                   : {
    page      : 1,
    perPage   : 100,
    fields    : 'groupCode name',
    condition : { groupCode: { $in: ['g'] } },
  },
  'group-delete'                     : { code: 'g' },
  'group-add-policy'                 : {
    code       : 'g',
    policyCode : 'p',
  },
  'group-remove-policy'              : {
    code       : 'g',
    policyCode : 'p',
  },
  'policy-create'                    : {
    identifier  : 'security.user.view.workspace',
    service     : 'security',
    section     : 'user',
    description : 'Read users',
    active      : true,
    base        : false,
    workspace   : 'allWorkspaces',
  },
  'policy-update'                    : {
    code        : 'p',
    description : 'Updated',
    active      : false,
  },
  'policy-get-one'                   : { code: 'p' },
  'policy-get-list'                  : {
    index   : '',
    base    : '',
    active  : 'active|inactive',
    sort    : 'identifier',
    order   : 'asc',
    page    : 1,
    perPage : 20,
  },
  'policy-get-index'                 : {},
  'policy-delete'                    : { code: 'p' },
  'workspaces-create'                : {
    name        : 'Workspace',
    description : '',
    picture     : '',
    workspace   : 'allWorkspaces',
  },
  'workspaces-update'                : {
    code : 'w',
    name : 'Workspace',
  },
  'workspaces-get-one'               : { code: 'w' },
  'workspaces-get-list'              : {
    search  : 'Workspace',
    page    : '1',
    perPage : '20',
    sort    : 'name',
    order   : 'asc',
  },
  'workspaces-delete'                : { code: 'w' },
  'settings-get-one'                 : { parameter: 'session-setings' },
  'settings-get-list'                : {},
  'settings-update'                  : {
    parameter : 'session-setings',
    data      : {
      multisession           : true,
      maximumFailedAttempts  : 3,
      tokenSessionExpiration : '1d',
    },
  },
  'agent-principal-activate'         : {
    agentCode         : 'a',
    workspace         : 'w',
    revision          : 1,
    confirmedRevision : 1,
  },
  'agent-principal-revoke'           : {
    agentCode : 'a',
    workspace : 'w',
    revision  : 1,
    operation : 'provisioning',
  },
  'agent-principal-provision'        : {
    agentCode  : 'a',
    workspace  : 'w',
    revision   : 1,
    name       : 'Agent',
    groups     : ['g'],
    workspaces : ['w'],
    state      : 'inactive',
  },
  'agent-principal-resolve'          : {
    agentCode           : 'a',
    workspace           : 'w',
    runCode             : 'run',
    initiatedByUserCode : 'u',
    confirmedRevision   : 1,
  },
  'agent-principal-audience'         : {
    agentCode         : 'a',
    workspace         : 'w',
    runCode           : 'run',
    userCodes         : ['u'],
    confirmedRevision : 1,
  },
  'agent-principal-authenticate'     : {
    token             : 'signed-fixture-token',
    confirmedRevision : 1,
  },
};

/**
 * Verifica las cargas vigentes de consumidores y que no quedan entradas raíz sin campos conocidos.
 * @returns {void} Finaliza al comprobar todos los contratos de entrada del servicio.
 */
function verifyInputs() {
  assert.equal(Object.keys(INPUTS).length, 39);
  for (const [name, value] of Object.entries(INPUTS)) {
    assert.equal(actionDtos[name].input(value), value, name);
    /** @returns {*} Entrada inválida con una proyección reservada al consumidor. */
    function selectedProjection() {
      return actionDtos[name].input({
        ...value,
        projection : 'private',
      });
    }
    assert.throws(selectedProjection, { statusCode: 400 });
  }
  for (const endpoint of manifest.endpoints) {
    assert.equal(endpoint.request.type, 'object', endpoint.name);
    assert.equal(endpoint.request.additionalProperties, false, endpoint.name);
    assert.equal(typeof endpoint.request.properties, 'object', endpoint.name);
  }
}

/**
 * Conserva datos multipart del Gateway y rechaza código, operadores o campos desconocidos.
 * @returns {void} Finaliza al comprobar estructuras anidadas e identificadores del recurso.
 */
function verifyNestedInputs() {
  const upload = {
    fileId           : 'file',
    name             : 'image.png',
    visibility       : 'public',
    generateVariants : true,
    tempFilePath     : '/temporary/fixture',
  };
  assert.equal(
    actionDtos['workspaces-create'].input({
      name          : 'Workspace',
      pictureUpload : upload,
    }).pictureUpload,
    upload,
  );
  /** @returns {*} Filtro con un operador no perteneciente al contrato público. */
  function rawCode() {
    return actionDtos['group-get-list'].input({ condition: { $where: 'arbitrary-code' } });
  }
  /** @returns {*} Estructura de archivo con un campo técnico no permitido. */
  function privateStorage() {
    return actionDtos['workspaces-create'].input({
      name          : 'Workspace',
      pictureUpload : {
        ...upload,
        storageKey : 'private',
      },
    });
  }
  /** @returns {*} Cambio de un parámetro con campos ajenos al dominio. */
  function unknownSetting() {
    return actionDtos['settings-update'].input({
      parameter : 'user-setings',
      data      : { unexpected: true },
    });
  }
  assert.throws(rawCode, { statusCode: 400 });
  assert.throws(privateStorage, { statusCode: 400 });
  assert.throws(unknownSetting, { statusCode: 400 });
  assert.equal(
    actionDtos['settings-update'].input({
      parameter : 'user-setings',
      data      : { tokenNotificationExpiration: 3600 },
    }).data.tokenNotificationExpiration,
    3600,
  );
}

/**
 * Caracteriza salidas reales de modelos y presentadores, incluidos 204, salud y operaciones 501.
 * @returns {Promise<void>} Finaliza al comprobar las fronteras sin abrir conexiones ni publicar efectos.
 */
async function verifyPublicOutputs() {
  const { applicationRecord } = require('../server/adapters/persistence/application-record');
  const definitions           = [
    {
      domain    : 'group',
      codeField : 'groupCode',
      data      : { name: 'Group' },
      model     : require('../server/modules/group/models/group.model'),
      presenter : require('../server/modules/group/presenters/group.presenter').groupPresenter,
    },
    {
      domain    : 'policy',
      codeField : 'policyCode',
      data      : {
        identifier  : 'security.user.view.global',
        service     : 'security',
        section     : 'user',
        description : 'Read',
      },
      model     : require('../server/modules/policy/models/policy.model'),
      presenter : require('../server/modules/policy/presenters/policy.presenter').policyPresenter,
    },
    {
      domain    : 'workspaces',
      codeField : 'workspaceCode',
      data      : { name: 'Workspace' },
      model     : require('../server/modules/workspaces/models/workspaces.model'),
      presenter : require('../server/modules/workspaces/presenters/workspaces.presenter')
        .workspacesPresenter,
    },
  ];
  for (const definition of definitions) {
    const record = applicationRecord(
      new definition.model({
        ...definition.data,
        [definition.codeField] : 'code',
        workspace              : 'w',
        userCreate             : '',
        userAssigned           : '',
      }),
    );
    const value  = definition.presenter({
      ...record,
      futurePrivate : 'private-fixture',
    });
    assert.equal(
      actionDtos[definition.domain + '-create'].output({
        statusCode : 201,
        data       : value,
      }).data,
      value,
    );
    assert.equal(
      actionDtos[definition.domain + '-get-one'].output({
        statusCode : 200,
        data       : value,
      }).data,
      value,
    );
    assert.deepEqual(
      actionDtos[definition.domain + '-get-one'].output({ statusCode: 204 }).data,
      {},
    );
    /** @returns {*} Respuesta de éxito incompleta que no equivale a un resultado de ausencia. */
    function incompleteSuccess() {
      return actionDtos[definition.domain + '-get-one'].output({
        statusCode : 200,
        data       : {},
      });
    }
    assert.throws(incompleteSuccess, { statusCode: 500 });
    assert.equal(JSON.stringify(value).includes('private-fixture'), false);
  }
  const unavailable = {
    release   : null,
    commit    : null,
    database  : 'unavailable',
    messaging : 'ready',
  };
  assert.equal(
    actionDtos.health.output({
      statusCode      : 503,
      descriptionCode : 'HEALTH',
      data            : unavailable,
    }).data,
    unavailable,
  );
  const settingsPresenter =
    require('../server/modules/settings/presenters/settings.presenter').settingsPresenter;
  const known             = settingsPresenter({
    parameter : 'user-setings',
    data      : {
      tokenNotificationExpiration : '1d',
      privateFuture               : true,
    },
  });
  assert.deepEqual(
    actionDtos['settings-get-one'].output({
      statusCode : 200,
      data       : known,
    }).data,
    {
      parameter : 'user-setings',
      data      : { tokenNotificationExpiration: '1d' },
    },
  );
  /** @returns {Object} Un parámetro ajeno al catálogo vigente no tiene representación pública. */
  function unknownSettings() {
    return settingsPresenter({
      parameter : 'removed-parameter',
      data      : { extensible: true },
    });
  }
  assert.throws(unknownSettings, {
    statusCode      : 500,
    descriptionCode : 'INVALID_SETTINGS_RECORD',
  });
  assert.deepEqual(
    actionDtos['session-get-one'].output({
      statusCode : 204,
      data       : null,
    }).data,
    null,
  );
}

test(
  'todas las acciones de Security tienen entradas explícitas y aceptan sus cargas conocidas',
  verifyInputs,
);
test(
  'los objetos anidados conservan imágenes y parámetros y rechazan consultas arbitrarias',
  verifyNestedInputs,
);
test(
  'las salidas de recursos conservan 204, salud 503 y el catálogo canónico de parámetros',
  verifyPublicOutputs,
);
