/** @file Verifica aislamiento externo, revocación, recuperación e imposibilidad de login interactivo. */
'use strict';
const test           = require('node:test');
const assert         = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  externalPrincipalService,
} = require('../server/modules/external-principal/services/external-principal.service');
const {
  externalPolicies,
} = require('../server/modules/external-principal/policies/external-access.policy');
const { identityService } = require('../server/modules/identity/services/identity.service');
const {
  userCredentialsService,
} = require('../server/modules/user/services/user-credentials.service');
const { ApplicationError } = require('../server/shared/application-error');
const contracts            = require('../server/contracts');
/** Construye repositorios mínimos con reloj controlado, sin base de datos ni tokens reales.
 * @returns {Object} Servicio, datos y controles de fallo.
 */
function fixture() {
  const rows = new Map(),
    sessions = new Map();
  const state = {
    time    : 2000000,
    allowed : true,
    failure : false,
    writes  : 0,
  };
  rows.set('owner', {
    userCode : 'owner',
    state    : 'active',
    userType : 'internal',
  });
  const dependencies = {
    users       : {
      /** @param {Object} query Filtro exacto. @returns {Promise<Object|null>} Cuenta de prueba. */
      async getOne(query) {
        const row = rows.get(query.userCode);
        if (!row) return null;
        if (query.state && query.state !== row.state) return null;
        if (query.userType && query.userType !== row.userType) return null;
        if (query.validity && row.validity !== undefined && row.validity <= state.time) return null;
        return structuredClone(row);
      },
      /** @param {Object} input Cuenta nueva. @returns {Promise<Object>} Confirma persistencia antes de simular respuesta perdida. */
      async create(input) {
        if (rows.has(input.userCode)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        rows.set(input.userCode, structuredClone(input));
        state.writes++;
        if (state.failure) {
          state.failure = false;
          throw new Error('lost-response');
        }
        return structuredClone(input);
      },
      /** @param {Object} filter Identidad. @param {Object} changes Campos autorizados. @returns {Promise<Object>} Cuenta actualizada. */
      async update(filter, changes) {
        const row = rows.get(filter.userCode);
        Object.assign(row, changes.$set);
        return structuredClone(row);
      },
    },
    sessions    : {
      /** @param {Object} query Token opaco exclusivamente interno. @returns {Promise<Object|null>} Sesión de prueba. */
      async getOne(query) {
        return sessions.get(query.token) || null;
      },
      /** @param {Object} input Sesión interna. @returns {Promise<Object>} Sesión confirmada sin JWT. */
      async create(input) {
        if (sessions.has(input.token)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        sessions.set(input.token, input);
        return input;
      },
    },
    workspaces  : {
      /** @returns {Promise<Object>} Workspace vigente. */
      async getOne() {
        return { workspaceCode: 'w' };
      },
    },
    groups      : {
      /** @returns {Promise<Object>} Grupo con membresía vigente. */
      async getOne() {
        return { workspace: 'w' };
      },
    },
    /** @param {Object} query Usuarios explícitos. @returns {Promise<Object>} Permisos actuales sin heredar privilegios del operador. */
    async principals(query) {
      return {
        items : [
          {
            userCode : query.userCodes[0],
            policies :
              query.userCodes[0] === 'owner'
                ? state.allowed
                  ? ['connect.meta.update.global']
                  : []
                : ['security.user.update.global', 'documents.entries.view.assigned'],
          },
        ],
      };
    },
    /** @returns {number} Reloj determinista. */
    now         : () => state.time,
    /** @param {string} value Contenido de la huella. @returns {string} Identificador estable. */
    fingerprint : (value) => createHash('sha256').update(value).digest('hex'),
  };
  return {
    service : externalPrincipalService(dependencies),
    rows,
    sessions,
    state,
    dependencies,
    input   : {
      contactCode      : 'contact',
      workspaceCode    : 'w',
      conversationCode : 'conversation',
      ownerUserCode    : 'owner',
      groups           : ['g'],
    },
  };
}
test('el alta externa se recupera tras respuesta perdida, no crea cuentas duplicadas y no devuelve credenciales' /** @returns {Promise<void>} Reintenta una escritura confirmada cuya respuesta se perdió. */, async () => {
  const f = fixture();
  f.state.failure = true;
  await assert.rejects(f.service.provision(f.input, 'service-apigateway'), /lost-response/);
  const value = await f.service.provision(f.input, 'service-apigateway');
  assert.deepEqual(value, {
    userCode    : 'contact',
    contactCode : 'contact',
  });
  assert.equal(f.state.writes, 1);
  assert.equal(f.rows.get('contact').password, '');
  assert.equal(f.rows.get('contact').activationToken, '');
  await assert.rejects(
    f.service.provision(
      {
        ...f.input,
        conversationCode : 'other',
      },
      'service-apigateway',
    ),
    { descriptionCode: 'EXTERNAL_IDENTITY_CONFLICT' },
  );
});
test('origen, administrador y cuenta activa se revalidan; los grupos no habilitan plataforma arbitraria' /** @returns {Promise<void>} Verifica bloqueo antes de efectos y reducción de permisos. */, async () => {
  const f = fixture();
  await assert.rejects(f.service.provision(f.input, 'service-connect'), { statusCode: 403 });
  assert.equal(f.state.writes, 0);
  await f.service.provision(f.input, 'service-apigateway');
  const resolved = await f.service.resolve(f.input, 'service-apigateway');
  assert(resolved.context.policies.includes('documents.entries.view.assigned'));
  assert(!resolved.context.policies.includes('security.user.update.global'));
  assert.equal(resolved.context.user.userType, 'external');
  assert.equal(resolved.context.externalConversationCode, 'conversation');
  assert(!Object.hasOwn(resolved, 'token'));
  f.state.allowed = false;
  await assert.rejects(f.service.resolve(f.input, 'service-apigateway'), {
    descriptionCode : 'META_OWNER_UNAVAILABLE',
  });
  f.state.allowed = true;
  f.rows.get('contact').state = 'blocked';
  await assert.rejects(f.service.resolve(f.input, 'service-apigateway'), { statusCode: 403 });
  await assert.rejects(f.service.provision(f.input, 'service-apigateway'), {
    descriptionCode : 'EXTERNAL_IDENTITY_REVOKED',
  });
});
test('sesiones externas expiran, se reutilizan dentro del intervalo y conservan TTL independiente' /** @returns {Promise<void>} Comprueba expiración acotada y ausencia de JWT de navegador. */, async () => {
  const f = fixture();
  await f.service.provision(f.input, 'service-apigateway');
  const first  = await f.service.resolve(f.input, 'service-apigateway');
  const second = await f.service.resolve(f.input, 'service-apigateway');
  assert.equal(first.context.sessionCode, second.context.sessionCode);
  assert(first.expiration * 1000 - f.state.time <= 300000);
  assert(first.expiration * 1000 > f.state.time);
  assert.equal(f.sessions.size, 1);
  const stored = [...f.sessions.values()][0];
  assert(stored.externalExpiresAt instanceof Date);
  assert(!stored.token.includes('.'));
  f.state.time += 300000;
  assert.notEqual(
    (await f.service.resolve(f.input, 'service-apigateway')).context.sessionCode,
    first.context.sessionCode,
  );
});
test('la identidad canónica externa requiere sesión interna, vínculo exacto y servicio permitido' /** @returns {Promise<void>} El contexto arbitrario no suplanta una identidad externa. */, async () => {
  const context = {
    user                     : { userCode: 'ext' },
    workspace                : 'w',
    sessionCode              : 's',
    externalConversationCode : 'linked',
  };
  const service = identityService({
    messaging     : {
      /** @returns {Object} Contexto controlado. */ getContext : () => context,
    },
    authorization : {
      /** @returns {Promise<Object>} Sesión y cuenta externas unidas por el mismo vínculo. */
      async read() {
        return {
          user       : {
            userCode                 : 'ext',
            userType                 : 'external',
            externalConversationCode : 'linked',
            workspaces               : ['w'],
          },
          session    : {
            activeWorkspace          : 'w',
            externalConversationCode : 'linked',
            workspaces               : ['w'],
            policies                 : externalPolicies([]),
          },
          workspaces : ['w'],
        };
      },
    },
  });
  assert.equal((await service.current('service-communication')).userCode, 'ext');
  context.externalConversationCode = 'other';
  await assert.rejects(service.current('service-communication'), { statusCode: 401 });
  context.externalConversationCode = 'linked';
  await assert.rejects(service.current('service-platform'), { statusCode: 401 });
});
test('un externo nunca autentica con contraseña aunque exista un hash o un administrador lo asigne' /** @returns {Promise<void>} Falla antes de comparar contraseñas. */, async () => {
  const service = userCredentialsService({
    ApplicationError,
    userState          : {
      document : {
        userType : 'external',
        password : 'hash',
        state    : 'active',
      },
    },
    settingsRepository : {
      /** @returns {Promise<Object>} Configuración existente. */ async get() {
        return { data: {} };
      },
    },
    settingsScopes     : { guest: Symbol('guest') },
    bcrypt             : {
      /** @returns {Promise<boolean>} Nunca debe alcanzarse. */ async compare() {
        assert.fail('interactive compare');
      },
    },
  });
  await assert.rejects(service.authentication('password'), {
    descriptionCode : 'EXTERNAL_INTERACTIVE_LOGIN_FORBIDDEN',
  });
});
test('contratos externos rechazan contexto, permisos y campos ajenos antes de invocar el dominio' /** @returns {void} Rechaza suplantación y valida las dos respuestas declaradas. */, () => {
  const f   = fixture();
  const dto = contracts.actionDtos['external-principal-provision'];
  assert.deepEqual(dto.input(f.input), f.input);
  assert.throws(
    /** @returns {Object} Entrada que intenta inyectar permisos. */
    () =>
      dto.input({
        ...f.input,
        policies : ['all'],
      }),
    { statusCode: 400 },
  );
  assert.throws(
    /** @returns {Object} Salida accidental con token. */
    () =>
      dto.output({
        statusCode : 200,
        data       : {
          userCode    : 'u',
          contactCode : 'u',
          token       : 'secret',
        },
      }),
    { statusCode: 500 },
  );
});
