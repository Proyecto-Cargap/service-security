/** @file Compatibilidad de DTO de usuarios con cargas de la web, Gateway, Platform y eventos de Directory. */
'use strict';
const test                 = require('node:test');
const assert               = require('node:assert/strict');
const dtos                 = require('../server/modules/user/dtos/user.actions.dto');
const contracts            = require('../server/contracts');
const manifest             = require('../server/contracts/service.json');
const { createActionDtos } = require('../server/contracts/action-dto');

const INPUTS = {
  'user-deletion-email'               : {
    userCode     : 'u',
    deletionDate : 1,
  },
  'user-reference-exists'             : {
    kind : 'role',
    code : 'r',
  },
  'user-register'                     : {
    user          : 'user@example.invalid',
    roleCode      : '100-customer',
    workspaceCode : 'w',
    name          : { firstName: 'Name' },
  },
  'user-update-password'              : {
    token    : 'fixture',
    password : 'Example123!',
  },

  'user-create'                       : {
    user          : 'user@example.invalid',
    roleCode      : 'r',
    groups        : ['g'],
    workspaces    : ['w'],
    workspace     : 'w',
    workspaceCode : 'w',
    name          : {
      firstName        : 'Name',
      lastNamePaternal : '',
      lastNameMaternal : '',
    },
    validity      : 1900000000000,
  },
  'user-update'                       : {
    code       : 'u',
    groups     : [],
    workspaces : ['w'],
    state      : 'active',
    validity   : 1900000000000,
  },
  'user-get-list'                     : {
    fields   : 'userCode user roleCode state',
    search   : 'first|last',
    roleCode : 'r|other',
    state    : 'active|blocked',
    page     : '1',
    perPage  : 20,
    sort     : 'user',
    order    : 'asc',
  },
  'user-get-one'                      : {
    code  : 'u',
    scope : 'workspace',
  },
  'user-get-one-byemail'              : { code: 'user@example.invalid' },
  'user-put-confirmation'             : { code: 'u' },
  'user-get-policy'                   : {
    identifier : 'read',
    page       : 1,
    perPage    : 100,
  },
  'user-recover-password'             : { user: 'user@example.invalid' },
  'user-delete'                       : {
    code     : 'u',
    MQReplic : false,
  },
  'user-confirm-user'                 : {
    token    : 'fixture',
    password : 'Example123!',
  },
  'directory.contact.update.roleCode' : {
    code     : 'u',
    roleCode : 'r',
  },
};

/**
 * Acredita todas las acciones de este dominio con cargas representativas de consumidores existentes.
 * @returns {void} Finaliza al verificar campos, rechazo de selectores y estructuras desconocidas.
 */
function verifyUserInputs() {
  assert.deepEqual(Object.keys(INPUTS).sort(), Object.keys(dtos).sort());
  for (const [name, input] of Object.entries(INPUTS)) {
    const dto = dtos[name];
    assert.equal(dto.input(input), input);
    assert.equal(dto.inputSchema.additionalProperties, false);
    /** @returns {*} Validación que debe rechazar proyecciones elegidas por el consumidor. */
    function consumerProjection() {
      return dto.input({
        ...input,
        consumer : 'fixture',
      });
    }
    /** @returns {*} Validación que debe rechazar un campo fuera del contrato. */
    function unknownProperty() {
      return dto.input({
        ...input,
        unknownField : true,
      });
    }
    assert.throws(consumerProjection, { statusCode: 400 });
    assert.throws(unknownProperty, { statusCode: 400 });
  }
  assert.deepEqual(dtos['user-get-policy'].input({ identifier: 'read' }), { identifier: 'read' });
  assert.equal(
    dtos['user-get-one'].input({
      code  : 'u',
      scope : null,
    }).scope,
    null,
  );
  assert.equal(
    dtos['user-create'].input({
      user     : 'user@example.invalid',
      roleCode : 'r',
      validity : '',
    }).validity,
    '',
  );
  assert.equal(
    dtos['user-update'].input({
      code     : 'u',
      validity : '2027-01-01T00:00:00Z',
    }).validity,
    '2027-01-01T00:00:00Z',
  );
  // El registro conserva el rechazo 403 de asignaciones administrativas dentro del dominio.
  assert.deepEqual(
    dtos['user-register'].input({
      ...INPUTS['user-register'],
      groups : ['forbidden'],
    }).groups,
    ['forbidden'],
  );
}

/**
 * Comprueba salidas positivas y rechaza documentos privados antes de entregar una respuesta RPC.
 * @returns {void} Finaliza al preservar sobres, páginas y ausencia de recuperación.
 */
function verifyUserOutputs() {
  const user = {
    userCode   : 'u',
    user       : 'user@example.invalid',
    state      : 'active',
    groups     : [],
    workspaces : [],
  };
  const page = {
    pagination : {
      total   : 1,
      page    : 1,
      perPage : 20,
    },
    items      : [user],
  };
  for (const name of [
    'user-create',
    'user-register',
    'user-get-one',
    'user-get-one-byemail',
    'user-delete',
    'user-confirm-user',
  ]) {
    const dto = dtos[name];
    assert.equal(
      dto.output({
        statusCode : 200,
        data       : user,
      }).data,
      user,
    );
    /** @returns {*} Salida inválida que contiene un hash interno. */
    function privateOutput() {
      return dto.output({
        statusCode : 200,
        data       : {
          ...user,
          password : 'private-fixture',
        },
      });
    }
    assert.throws(privateOutput, { statusCode: 500 });
  }
  for (const name of ['user-get-list', 'user-get-policy']) {
    assert.equal(
      dtos[name].output({
        statusCode : 200,
        data       : page,
      }).data,
      page,
    );
    /** @returns {*} Página inválida con datos de recuperación privados. */
    function privatePage() {
      return dtos[name].output({
        statusCode : 200,
        data       : {
          ...page,
          items : [
            {
              ...user,
              passwordRecoveryHash : 'private-fixture',
            },
          ],
        },
      });
    }
    assert.throws(privatePage, { statusCode: 500 });
  }
  assert.equal(
    dtos['user-recover-password'].output({
      statusCode : 200,
      data       : null,
    }).data,
    null,
  );
  assert.deepEqual(dtos['user-update'].output({ statusCode: 200 }).data, {});
  assert.deepEqual(
    dtos['user-get-one'].output({
      statusCode      : 403,
      descriptionCode : 'FORBIDDEN',
    }),
    {
      statusCode      : 403,
      descriptionCode : 'FORBIDDEN',
    },
  );
}

/**
 * Conserva el rol público de Directory, incluidas su revisión y sus propiedades anulables.
 * @returns {void} Las páginas aceptan el contrato canónico sin abrir campos privados ni revisiones inválidas.
 */
function verifyDirectoryRoleOutputs() {
  const role = {
    roleCode     : 'r',
    name         : 'Rol de prueba',
    workspace    : 'allWorkspaces',
    active       : true,
    userCreate   : null,
    userAssigned : null,
    updateDate   : null,
    erased       : false,
    revision     : 0,
  };
  /** @param {Object|null} value Rol público consultado. @returns {Object} Página pública mínima de usuarios. */
  function page(value) {
    return {
      statusCode : 200,
      data       : {
        pagination : {
          total   : 1,
          page    : 1,
          perPage : 20,
        },
        items      : [
          {
            userCode : 'u',
            user     : 'user@example.invalid',
            role     : value,
          },
        ],
      },
    };
  }
  for (const name of ['user-get-list', 'user-get-policy']) {
    for (const value of [
      role,
      {
        ...role,
        name     : null,
        active   : null,
        revision : 3,
      },
      null,
    ])
      assert.deepEqual(dtos[name].output(page(value)).data.items[0].role, value);
    for (const value of [
      {
        ...role,
        revision : -1,
      },
      {
        ...role,
        revision : 0.5,
      },
      {
        ...role,
        revision : '1',
      },
      {
        ...role,
        password : 'private-fixture',
      },
    ])
      assert.throws(
        /** @returns {Object} La salida debe rechazar valores ajenos al contrato canónico. */
        () => dtos[name].output(page(value)),
        { statusCode: 500 },
      );
  }
}

test(
  'las páginas de usuarios conservan el rol canónico con revisión de Directory',
  verifyDirectoryRoleOutputs,
);

/**
 * Prueba la construcción del catálogo con una definición inválida antes de ejecutar una acción.
 * @returns {void} Finaliza al acreditar el fallo temprano sin invocar colaboradores.
 */
function verifyInvalidCatalogDefinition() {
  const fixture = {
    name     : 'invalid-schema-fixture',
    kind     : 'action',
    request  : {
      type   : 'string',
      format : 'email',
    },
    response : { $ref: '#/responseEnvelope' },
  };
  manifest.endpoints.push(fixture);
  /** @returns {Object} DTO cuya definición debe rechazarse antes de atender solicitudes. */
  function composeInvalidDto() {
    return createActionDtos([fixture.name]);
  }
  try {
    assert.throws(composeInvalidDto, /INVALID_SCHEMA:invalid-schema-fixture.request.format/);
  } finally {
    manifest.endpoints.pop();
  }
  assert(contracts.actionDtos['user-get-one']);
}

test(
  'las entradas históricas de usuarios tienen campos explícitos y reutilizables',
  verifyUserInputs,
);
test('las salidas de usuarios excluyen datos privados y conservan sus sobres', verifyUserOutputs);
test(
  'un esquema no soportado impide construir el DTO del catálogo',
  verifyInvalidCatalogDefinition,
);
