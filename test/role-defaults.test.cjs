/** @file Asignación por rol: validación, persistencia, altas, permisos e integridad con colaboradores aislados. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  roleDefaultsService,
} = require('../server/modules/settings/services/role-defaults.service');
const { settingsService } = require('../server/modules/settings/services/settings.service');
const {
  userRegistrationService,
} = require('../server/modules/user/services/user-registration.service');
const { userReferenceService } = require('../server/modules/user/services/user-reference.service');
const createGroup              = require('../server/modules/group/services/group.service');
const createSettingsRepository = require('../server/modules/settings/repositories/settings.repository');
const { settingsPresenter }    = require('../server/modules/settings/presenters/settings.presenter');
const dtos                     = require('../server/modules/settings/dtos/settings.actions.dto');
const { ApplicationError }     = require('../server/shared/application-error');
const mappings                 = [
  {
    roleCode   : '100-customer',
    groupCodes : ['g1', 'g2'],
  },
];

/** Construye lectores controlables y registra consultas sin conexiones externas.
 * @returns {Object} Estado y servicio de referencias para las pruebas.
 */
function defaultsFixture() {
  const state    = {
    record  : {
      data : {
        defaultGroupsByRole         : structuredClone(mappings),
        tokenNotificationExpiration : '1d',
      },
    },
    group   : {
      workspace : 'allWorkspaces',
      erased    : false,
    },
    role    : {
      active : true,
      erased : false,
    },
    failure : null,
    reads   : [],
  };
  const defaults = roleDefaultsService({
    /** @returns {Promise<Object>} Instantánea o fallo técnico explícito. */
    async readSettings() {
      if (state.failure) throw state.failure;
      return state.record;
    },
    /** @param {string} code Código. @param {boolean} internal Origen autorizado. @returns {Promise<Object|null>} Perfil o ausencia. */
    async readGroup(code, internal) {
      state.reads.push({
        code,
        internal,
      });
      if (state.failure) throw state.failure;
      return state.group;
    },
    /** @returns {Promise<Object|null>} Rol vigente o ausencia. */
    async readRole() {
      if (state.failure) throw state.failure;
      return state.role;
    },
  });
  return {
    state,
    defaults,
  };
}

test('valida asignaciones múltiples y rechaza estructura abierta, duplicados y referencias inválidas' /** @returns {Promise<void>} Comprueba estructura y catálogos independientemente del transporte. */, async () => {
  const { state, defaults } = defaultsFixture();
  await defaults.validate(mappings);
  assert.deepEqual(state.reads, [
    {
      code     : 'g1',
      internal : false,
    },
    {
      code     : 'g2',
      internal : false,
    },
  ]);
  for (const invalid of [
    null,
    {},
    [
      {
        roleCode   : ' ',
        groupCodes : [],
      },
    ],
    [...mappings, ...mappings],
    [
      {
        roleCode   : 'r',
        groupCodes : ['g', 'g'],
      },
    ],
    [
      {
        roleCode   : 'r',
        groupCodes : [],
        extra      : true,
      },
    ],
  ])
    await assert.rejects(defaults.validate(invalid), { statusCode: 400 });
  state.group = { workspace: 'w' };
  await assert.rejects(defaults.validate(mappings), { descriptionCode: 'INVALID_DEFAULT_GROUP' });
  state.group = null;
  await assert.rejects(defaults.resolve(state.record, '100-customer'), { statusCode: 409 });
  state.role = { active: false };
  await assert.rejects(defaults.validate(mappings), { descriptionCode: 'INVALID_DEFAULT_ROLE' });
});

test('la ausencia conserva listas vacías y los fallos de consulta nunca conceden un alta parcial' /** @returns {Promise<void>} Diferencia ausencia del campo, rol sin asignación e indisponibilidad. */, async () => {
  const { state, defaults } = defaultsFixture();
  assert.deepEqual(await defaults.resolve({}, '100-customer'), []);
  assert.deepEqual(await defaults.resolve(state.record, '300-supplier'), []);
  assert.deepEqual(await defaults.resolve(state.record, '100-customer'), ['g1', 'g2']);
  assert.equal(await defaults.uses('role', '100-customer'), true);
  assert.equal(await defaults.uses('group', 'g2'), true);
  assert.equal(await defaults.uses('group', 'other'), false);
  state.failure = new ApplicationError(503, 'READ_UNAVAILABLE');
  await assert.rejects(defaults.resolve(state.record, '100-customer'), state.failure);
  await assert.rejects(defaults.uses('group', 'g2'), state.failure);
});

test('el contrato, repositorio y presentador conservan asignaciones y los otros ajustes' /** @returns {Promise<void>} Recorre DTO, persistencia parcial y proyección de lectura. */, async () => {
  let row       = {
    parameter    : 'user-setings',
    workspace    : 'allWorkspaces',
    userCreate   : '',
    userAssigned : '',
    data         : { tokenNotificationExpiration: '1d' },
  };
  let permitted = true;
  const repo    = createSettingsRepository({
    messaging : {
      /** @returns {Promise<void>} La referencia se confirma dentro de la transacción simulada. */
      async publishEvent() {},
      /** @returns {Object} Contexto controlado con permiso explícito. */
      getContext : () => ({
        user     : { userCode: 'u' },
        policies : permitted ? ['security.settings.update.global'] : [],
      }),
    },
    model     : {
      db : {
        /** @param {Function} work Unidad de escritura y publicación. @returns {Promise<Object>} Resultado confirmado. */
        transaction : async (work) => work({}),
      },
      /** @param {Object} filter Selector autorizado. @param {Object} change Campos parciales. @returns {Promise<Object>} Registro persistido. */
      async findOneAndUpdate(filter, change) {
        assert.equal(filter.$and[0].parameter, 'user-setings');
        for (const [key, value] of Object.entries(change.$set))
          row.data[key.slice(5)] = structuredClone(value);
        return structuredClone(row);
      },
    },
  });
  const input   = {
    parameter : 'user-setings',
    data      : { defaultGroupsByRole: mappings },
    scope     : 'global',
  };
  dtos['settings-update'].input(input);
  row = await repo.update(input.parameter, input.data, input.scope);
  assert.equal(row.data.tokenNotificationExpiration, '1d');
  const presented = settingsPresenter(row);
  dtos['settings-get-one'].output({
    statusCode : 200,
    data       : presented,
  });
  dtos['settings-get-list'].output({
    statusCode : 200,
    data       : [presented],
  });
  assert.deepEqual(presented.data.defaultGroupsByRole, mappings);
  await repo.update(input.parameter, { defaultGroupsByRole: [] }, 'global');
  assert.deepEqual(row.data.defaultGroupsByRole, []);
  permitted = false;
  await assert.rejects(repo.update(input.parameter, input.data, 'global'), { statusCode: 403 });
});

test('el servicio autoriza antes de consultar catálogos y valida antes de persistir' /** @returns {Promise<void>} No hay lecturas ni escrituras para un operador sin permiso. */, async () => {
  const { state, defaults } = defaultsFixture();
  const effects             = [];
  let policies              = [];
  const service             = settingsService({
    roleDefaults : defaults,
    settings     : {
      /** @returns {Promise<Object>} Confirmación de escritura. */
      async update() {
        effects.push('write');
        return {};
      },
    },
    messaging    : {
      /** @returns {Object} Permisos modificables de prueba. */
      getContext : () => ({
        user : { userCode: 'u' },
        policies,
      }),
      /** @returns {Promise<void>} Aviso posterior al guardado. */
      async sendCommand() {
        effects.push('notify');
      },
    },
  });
  const input               = {
    parameter : 'user-setings',
    data      : { defaultGroupsByRole: mappings },
  };
  await assert.rejects(service.update(input), { statusCode: 403 });
  assert.deepEqual(state.reads, []);
  assert.deepEqual(effects, []);
  policies = ['security.settings.update.global'];
  state.group = null;
  await assert.rejects(service.update(input), { statusCode: 409 });
  assert.deepEqual(effects, []);
  state.group = { workspace: 'allWorkspaces' };
  await service.update(input);
  assert.deepEqual(effects, ['write']);
});

/** Arma el flujo real de altas con cuentas y efectos observables.
 * @returns {Object} Servicio, estado y configuración controlables.
 */
function registrationFixture() {
  const { state, defaults } = defaultsFixture();
  const effects             = [];
  const scopes              = { guest: Symbol('internal') };
  const account             = { current: null };
  const service             = userRegistrationService({
    ApplicationError,
    roleDefaults         : defaults,
    controller           : 'user',
    id                   : 'test',
    dependencies         : {},
    userScopes           : scopes,
    workspacesScopes     : scopes,
    userState            : {},
    logger               : { /** @returns {void} Sin registros externos. */ error() {} },
    /** @returns {Promise<Object>} Configuración de la misma lectura usada en el alta. */
    confirmationSettings : async () => state.record,
    /** @returns {string} Marcador sin credenciales reales. */
    confirmationToken    : () => 'test-token',
    counter              : {
      /** @returns {Promise<string>} Código de prueba. */ getObjectCode : async () => 'USR1',
    },
    platformInformation  : {
      /** @returns {Promise<Object>} Identidad de prueba. */ read : async () => ({
        publicUrl : 'https://example.invalid',
        title     : 'Test',
      }),
    },
    userPolicy           : {
      /** @param {string} action Operación. @param {Object} data Datos. @returns {Object} Autorización de prueba. */ authorize :
        (action, data) => data,
    },
    userRepository       : {
      /** @returns {Promise<Object|null>} Cuenta previa o ausencia. */ getOne : async () =>
        account.current,
      /** @param {Object} data Alta. @returns {Promise<Object>} Cuenta creada. */
      async create(data) {
        effects.push('user');
        account.current = {
          ...data,
          state : 'registered',
        };
        return account.current;
      },
      /** @param {Object} filter Selector. @param {Object} data Cambios. @returns {Promise<Object>} Cuenta reactivada. */
      async update(filter, data) {
        effects.push('update');
        account.current = {
          ...account.current,
          ...data,
        };
        return account.current;
      },
    },
    messaging            : {
      /** @returns {Object} Contexto autorizado para las altas administrativas. */
      getContext : () => ({
        user      : { userCode: 'admin' },
        workspace : 'w',
      }),
      /** @param {string} target Servicio. @param {string} action Acción. @returns {Promise<Object>} Contacto creado o consultado. */
      async request(target, action) {
        if (action === 'contact-register') effects.push('contact');
        return {
          statusCode : action === 'contact-register' ? 201 : 200,
          data       : {
            contactCode : 'c',
            userCode    : 'c',
          },
        };
      },
      /** @returns {Promise<void>} Evento registrado. */ async publishEvent() {
        effects.push('event');
      },
      /** @returns {Promise<void>} Aviso registrado. */ async sendCommand() {
        effects.push('command');
      },
    },
    utilities            : {
      /** @param {Function} read Lector de páginas. @returns {Promise<Object>} Página completa de prueba. */ collectPages        :
        async (read) =>
          read({
            page    : 1,
            perPage : 100,
          }),
      /** @param {Object} a Colección. @param {Object} b Colección. @returns {boolean} Igualdad de membresías. */ arraysAreEqual :
        (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
    /** @returns {Object} Lector aislado de espacios. */
    workspacesService    : () => ({
      /** @returns {Promise<Object>} Espacio vigente. */ getOne    : async () => ({
        workspaceCode : 'w',
      }),
      /** @returns {Promise<Object>} Catálogo completo. */ getList : async () => ({
        items : [{ workspaceCode: 'w' }],
      }),
    }),
  });
  return {
    service,
    state,
    effects,
    account,
  };
}

test('las altas públicas y administrativas aplican defaults; listas explícitas tienen prioridad' /** @returns {Promise<void>} Verifica resolución en ambas modalidades y el significado de []. */, async () => {
  const input = {
    user          : 'new@example.invalid',
    roleCode      : '100-customer',
    workspaceCode : 'w',
  };
  for (const workspaceCode of ['w', 'allWorkspaces']) {
    const f = registrationFixture();
    assert.deepEqual(
      (
        await f.service.register({
          ...input,
          workspaceCode,
        })
      ).groups,
      ['g1', 'g2'],
    );
    assert.equal(f.state.reads[0].internal, true);
  }
  assert.deepEqual((await registrationFixture().service.create(input)).groups, ['g1', 'g2']);
  for (const groups of [[], ['manual']]) {
    const f = registrationFixture();
    assert.deepEqual(
      (
        await f.service.create({
          ...input,
          groups,
        })
      ).groups,
      groups,
    );
    assert.deepEqual(f.state.reads, []);
  }
  const unconfigured = registrationFixture();
  unconfigured.state.record = { data: { tokenNotificationExpiration: '1d' } };
  assert.deepEqual((await unconfigured.service.create(input)).groups, []);
});

test('las referencias inválidas y roles internos públicos fallan antes de crear efectos' /** @returns {Promise<void>} No concede permisos por manipular el rol o los grupos enviados. */, async () => {
  const input = {
    user          : 'new@example.invalid',
    roleCode      : '100-customer',
    workspaceCode : 'w',
  };
  const f     = registrationFixture();
  f.state.group = null;
  await assert.rejects(f.service.register(input), { statusCode: 409 });
  assert.deepEqual(f.effects, []);
  f.state.failure = new ApplicationError(503, 'READ_UNAVAILABLE');
  await assert.rejects(f.service.create(input), { statusCode: 503 });
  assert.deepEqual(f.effects, []);
  for (const workspaceCode of ['w', 'allWorkspaces'])
    await assert.rejects(
      f.service.register({
        ...input,
        workspaceCode,
        roleCode : '000-root',
      }),
      { descriptionCode: 'REGISTRATION_ROLE_FORBIDDEN' },
    );
  await assert.rejects(
    f.service.register({
      ...input,
      groups : ['admin'],
    }),
    { descriptionCode: 'GROUP_ASSIGNMENT_FORBIDDEN' },
  );
  assert.deepEqual(f.effects, []);
});

test('reactivar una cuenta conserva sus perfiles y no consulta defaults' /** @returns {Promise<void>} Una configuración modificada no sobrescribe cuentas previas. */, async () => {
  const f = registrationFixture();
  f.account.current = {
    _id         : 'id',
    userCode    : 'c',
    contactCode : 'c',
    code        : 'USR1',
    groups      : ['previous'],
    state       : 'registered',
    workspace   : 'w',
    workspaces  : ['w'],
  };
  const result = await f.service.create({
    user          : 'old@example.invalid',
    roleCode      : '100-customer',
    workspaceCode : 'w',
  });
  assert.deepEqual(result.groups, ['previous']);
  assert.deepEqual(f.state.reads, []);
  assert.equal(f.effects.includes('contact'), false);
});

test('los roles y perfiles configurados no pueden eliminarse ni perder su ámbito global' /** @returns {Promise<void>} Recorre consultas de integridad y mantenimiento reales. */, async () => {
  const { defaults } = defaultsFixture();
  const references   = userReferenceService({
    roleDefaults   : defaults,
    userReferences : {
      /** @returns {Promise<boolean>} No hay usuarios asignados. */ hasRoleReference : async () =>
        false,
    },
  });
  assert.deepEqual(
    await references.exists({
      kind : 'role',
      code : '100-customer',
    }),
    { used: true },
  );
  const group = createGroup({
    roleDefaults : defaults,
    repositories : {
      group : {
        /** @returns {Promise<Object>} Perfil autorizado. */ getOne                  : async () => ({
          groupCode : 'g1',
          workspace : 'allWorkspaces',
          name      : 'Perfil',
          policies  : [],
        }),
        /** @returns {Promise<boolean>} Sin usuarios vinculados. */ hasAssignedUsers : async () =>
          false,
      },
    },
    messaging    : {
      /** @returns {Object} Permisos administrativos explícitos. */ getContext : () => ({
        user      : { userCode: 'admin' },
        workspace : 'w',
        policies  : ['security.group.delete.global', 'security.group.update.global'],
      }),
    },
  });
  await assert.rejects(group.delete({ groupCode: 'g1' }), { descriptionCode: 'GROUP_IN_USE' });
  await assert.rejects(group.update({ groupCode: 'g1' }, { workspace: 'w' }), {
    descriptionCode : 'GROUP_IN_USE',
  });
});

test('el registro móvil conserva los perfiles comerciales configurados y respeta una asignación explícita', /** @returns {Promise<void>} Traduce sólo las equivalencias CARGAP y valida los perfiles antes del alta. */ async () => {
  const { state, defaults } = defaultsFixture();
  state.record.data.defaultGroupsByRole = [
    {
      roleCode   : 'ROL-200-CUSTOMER',
      groupCodes : ['customer-group'],
    },
    {
      roleCode   : 'ROL-300-SUPPLIER',
      groupCodes : ['supplier-group'],
    },
  ];
  assert.deepEqual(await defaults.resolve(state.record, '100-customer'), ['customer-group']);
  assert.deepEqual(await defaults.resolve(state.record, '300-supplier'), ['supplier-group']);
  assert.deepEqual(await defaults.resolve(state.record, 'unmapped'), []);
  state.record.data.defaultGroupsByRole.push({
    roleCode   : '100-customer',
    groupCodes : ['explicit-group'],
  });
  assert.deepEqual(await defaults.resolve(state.record, '100-customer'), ['explicit-group']);
  state.group.erased = true;
  await assert.rejects(defaults.resolve(state.record, '300-supplier'), { statusCode: 409 });
});
