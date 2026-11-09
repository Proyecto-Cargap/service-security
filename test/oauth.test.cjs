/** @file Consentimiento delegado, permisos vigentes y persistencia OAuth atómica sin servicios remotos. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const crypto                 = require('node:crypto');
const { oauthService }       = require('../server/modules/oauth/services/oauth.service');
const { oauthRepository }    = require('../server/modules/oauth/repositories/oauth.repository');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
/** @returns {Object} Identidades mutables para acreditar revocación sin confiar en el contexto enviado. */
function fixture() {
  const grants  = new Map();
  const state   = {
    now                  : 1800000000000,
    credentialsChangedAt : 0,
    userCode             : 'U1',
    actor                : {},
    workspaces           : ['W1', 'W2'],
    workspaceNames       : {
      W1 : 'Corporativo',
      W2 : 'Ventas',
      W3 : 'No consentido',
    },
    referenceRequests    : [],
    policies             : {
      W1 : [
        'customer.customer.view.global',
        'customer.customer.update.global',
        'security.settings.update.global',
      ],
      W2 : ['customer.customer.view.workspace'],
    },
  };
  const service = oauthService({
    /** @returns {Object} Contexto de la llamada actual. */ context : () => state.actor,
    /** @returns {number} Instante controlado. */ now               : () => state.now,
    /** @returns {Promise<Object>} Cuenta activa sintética. */ async account() {
      return { credentialsChangedAt: state.credentialsChangedAt };
    },
    /** @param {string[]} codes Selección acreditada. @returns {Promise<Object[]>} Incluye una fila ajena para probar el filtro final del caso de uso. */
    async workspaceReferences(codes) {
      state.referenceRequests.push([...codes]);
      return Object.entries(state.workspaceNames).map(
        /** @param {Array} entry Referencia sintética vigente. @returns {Object} Registro público con un campo interno que no debe salir. */
        ([workspaceCode, name]) => ({
          workspaceCode,
          name,
          _id : 'private',
        }),
      );
    },
    identities                                                      : {
      /** @returns {Promise<Object>} Sesión humana verificada. */ async current() {
        return {
          userCode   : state.userCode,
          workspace  : 'W1',
          workspaces : state.workspaces,
        };
      },
      /** @param {Object} input Selección. @returns {Promise<Object>} Membresías y permisos vigentes. */ async principals(
        input,
      ) {
        return {
          items : state.workspaces.includes(input.workspace)
            ? [
                {
                  userCode : input.userCodes[0],
                  policies : state.policies[input.workspace] || [],
                },
              ]
            : [],
        };
      },
    },
    store                                                           : {
      /** @param {Object} grant Concesión. @returns {Promise<void>} Instantánea inmutable. */ async createGrant(
        grant,
      ) {
        grants.set(grant.code, structuredClone(grant));
      },
      /** @param {string} code Identidad. @returns {Promise<Object|undefined>} Estado actual. */ async getGrant(
        code,
      ) {
        return grants.get(code);
      },
      /** @param {string} userCode Titular. @returns {Promise<Object[]>} Sólo propias. */ async listGrants(
        userCode,
      ) {
        return [...grants.values()].filter(
          /** @param {Object} grant Fila. @returns {boolean} Titular. */ (grant) =>
            grant.userCode === userCode,
        );
      },
      /** @param {string} code Concesión. @returns {Promise<void>} Revocación inmediata. */ async revoke(
        code,
      ) {
        grants.get(code).active = false;
      },
    },
  });
  /** @param {Object} extra Selección opcional. @returns {Promise<Object>} Consentimiento explícito. */
  function grant(extra = {}) {
    return service.grantCreate(
      {
        grantCode  : 'G1',
        clientId   : 'C1',
        clientName : 'Asistente',
        scopes     : ['customer:read'],
        workspaces : ['W1', 'W2'],
        ...extra,
      },
      'service-apigateway',
    );
  }
  return {
    state,
    service,
    grants,
    grant,
  };
}
test('consentimiento no amplía permisos, membresías nuevas ni workspaces y revoca inmediatamente', /** @returns {Promise<void>} Matriz de autorización y propiedad. */ async () => {
  const f = fixture();
  await f.grant();
  const select = {
    grantCode : 'G1',
    clientId  : 'C1',
    workspace : 'W1',
  };
  let result   = await f.service.resolve(select, 'service-apigateway');
  assert.deepEqual(result.policies, ['customer.customer.view.global']);
  assert.equal((await f.service.resolve({ grantCode: 'G1' }, 'service-apigateway')).workspace, '');
  f.state.workspaces.push('W3');
  f.state.policies.W1.push('customer.opportunity.view.global');
  result = await f.service.resolve(select, 'service-apigateway');
  assert.deepEqual(result.policies, ['customer.customer.view.global']);
  assert.deepEqual(result.workspaces, ['W1', 'W2']);
  await assert.rejects(
    f.service.resolve(
      {
        ...select,
        workspace : 'W3',
      },
      'service-apigateway',
    ),
    { statusCode: 403 },
  );
  f.state.policies.W1 = [];
  assert.deepEqual((await f.service.resolve(select, 'service-apigateway')).policies, []);
  f.state.workspaces = ['W2'];
  await assert.rejects(f.service.resolve(select, 'service-quotation'), { statusCode: 403 });
  await assert.rejects(
    f.service.resolve(
      {
        ...select,
        workspace : 'W2',
        clientId  : 'forged',
      },
      'service-apigateway',
    ),
    { statusCode: 401 },
  );
  f.state.userCode = 'U2';
  assert.deepEqual(await f.service.grantList({}, 'service-apigateway'), { items: [] });
  await assert.rejects(f.service.grantRevoke({ grantCode: 'G1' }, 'service-apigateway'), {
    statusCode : 404,
  });
  f.state.userCode = 'U1';
  await f.service.grantRevoke({ grantCode: 'G1' }, 'service-apigateway');
  await assert.rejects(f.service.resolve({ grantCode: 'G1' }, 'service-apigateway'), {
    statusCode : 401,
  });
});
test('no autoriza sesiones delegadas, orígenes extraños, credenciales cambiadas o concesiones vencidas', /** @returns {Promise<void>} Fallos cerrados antes de ejecutar negocio. */ async () => {
  const f = fixture();
  await assert.rejects(f.grant({ workspaces: ['allWorkspaces'] }), { statusCode: 403 });
  await assert.rejects(f.service.storageGet({}, 'service-customer'), { statusCode: 403 });
  f.state.actor = { delegation: { grantCode: 'old' } };
  await assert.rejects(f.grant(), { statusCode: 403 });
  f.state.actor = {};
  await f.grant();
  f.state.credentialsChangedAt++;
  await assert.rejects(f.service.resolve({ grantCode: 'G1' }, 'service-quotation'), {
    statusCode : 401,
  });
  f.state.credentialsChangedAt = 0;
  f.state.now += 30 * 86400000;
  await assert.rejects(f.service.resolve({ grantCode: 'G1' }, 'service-apigateway'), {
    statusCode : 401,
  });
});
test('contexto OAuth resuelve nombres actuales sólo dentro del consentimiento y membresías vigentes', /** @returns {Promise<void>} Nombres renombrados, membresías retiradas y campos privados se tratan correctamente. */ async () => {
  const f = fixture();
  await f.grant();
  const basic = await f.service.resolve({ grantCode: 'G1' }, 'service-apigateway');
  assert.equal(basic.workspaceDetails, undefined);
  assert.deepEqual(f.state.referenceRequests, []);
  f.state.workspaces.push('W3');
  const input = {
    grantCode               : 'G1',
    includeWorkspaceDetails : true,
  };
  let result  = await f.service.resolve(input, 'service-apigateway');
  assert.deepEqual(result.workspaceDetails, [
    {
      workspaceCode : 'W1',
      name          : 'Corporativo',
    },
    {
      workspaceCode : 'W2',
      name          : 'Ventas',
    },
  ]);
  assert.deepEqual(f.state.referenceRequests.at(-1), ['W1', 'W2']);
  f.state.workspaceNames.W1 = 'Corporativo actualizado';
  result = await f.service.resolve(input, 'service-apigateway');
  assert.equal(result.workspaceDetails[0].name, 'Corporativo actualizado');
  f.state.workspaces = ['W2', 'W3'];
  result = await f.service.resolve(input, 'service-apigateway');
  assert.deepEqual(result.workspaces, ['W2']);
  assert.deepEqual(result.workspaceDetails, [
    {
      workspaceCode : 'W2',
      name          : 'Ventas',
    },
  ]);
  assert.deepEqual(f.state.referenceRequests.at(-1), ['W2']);
});
test(
  'almacenamiento OAuth real: consumo concurrente exclusivo, caducidad y revocación',
  { skip: !process.env.TEST_MONGOD_BINARY },
  /** @param {Object} t Ciclo aislado. @returns {Promise<void>} Comprueba atomicidad Mongo sin infraestructura compartida. */ async (
    t,
  ) => {
    const mongo = await startIsolatedMongo({
      binary   : process.env.TEST_MONGOD_BINARY,
      mongoose : require('mongoose'),
    });
    t.after(mongo.stop);
    const db         = mongo.connection.db;
    let rejectAccess = false;
    const repository = oauthRepository({
      transaction                                                              : mongo.connection.transaction.bind(mongo.connection),
      /** @param {string} name Evento. @param {Object} data Referencia. @param {Object} options Transacción. @returns {Promise<void>} Outbox aislado con fallo inducido. */
      async publishEvent(name, data, options) {
        await db.collection('TEST_OUTBOX').insertOne(
          {
            name,
            data,
          },
          options,
        );
        if (rejectAccess) throw new Error('OUTBOX_FAILED');
      },
      /** @returns {Object} Base aislada. */ db                                : () => db,
      /** @param {string} input Artefacto. @returns {string} Huella. */ digest : (input) =>
        crypto.createHash('sha256').update(input).digest('hex'),
    });
    const now = Date.now(),
      input   = {
        model   : 'AuthorizationCode',
        id      : 'private-code',
        payload : '{"value":"test"}',
        ttl     : 60,
        grantId : 'G1',
        uid     : '',
      };
    await repository.put(input, now);
    const consumed = await Promise.all(
      Array.from(
        { length: 8 },
        /** @returns {Promise<boolean>} Consumo simultáneo. */ () => repository.consume(input, now),
      ),
    );
    assert.equal(consumed.filter(Boolean).length, 1);
    assert.equal((await repository.get(input, now)).consumed, Math.floor(now / 1000));
    assert.equal(await repository.get(input, now + 60000), null);
    await repository.recordExecution({
      operationCode : 'E1',
      grantCode     : 'G1',
      userCode      : 'U1',
      workspace     : 'W1',
      clientId      : 'C1',
      tool          : 'customer-create',
      statusCode    : 201,
      durationMs    : 10,
      createdAt     : now,
    });
    const execution = await db
      .collection('SECURITY_OAUTH_EXECUTION')
      .findOne({ operationCode: 'E1' });
    assert.equal(execution.expiresAt.getTime(), now + 90 * 86400000);
    assert.equal(execution.payload, undefined);
    const stored = await db.collection('SECURITY_OAUTH_RECORD').findOne({});
    assert.notEqual(stored._id, input.id);
    assert.equal(stored.id, undefined);
    await repository.createGrant({
      code     : 'G1',
      userCode : 'U1',
      active   : true,
    });
    rejectAccess = true;
    await assert.rejects(repository.revoke('G1'), /OUTBOX_FAILED/);
    assert.equal((await repository.getGrant('G1')).active, true);
    assert.ok(await repository.get(input, now));
    assert.equal(await db.collection('TEST_OUTBOX').countDocuments({}), 1);
    rejectAccess = false;
    await repository.revoke('G1');
    await repository.revoke('G1');
    assert.equal(await db.collection('TEST_OUTBOX').countDocuments({}), 2);
    assert.equal((await repository.getGrant('G1')).active, false);
    assert.equal(await repository.get(input, now), null);
  },
);

/** @returns {void} Separa capacidades de los cuatro dominios y nunca delega custodia fiscal. */
function extendedScopes() {
  const { delegatedPolicies } = require('../server/modules/oauth/policies/oauth-scope.policy');
  const policies              = [
    'directory.contact.view.global',
    'directory.contact.delete.global',
    'directory.settings.update.global',
    'documents.workspace.create.global',
    'documents.workspace.delete.global',
    'documents.settings.update.global',
    'projects.project.update.global',
    'projects.project-type.update.global',
    'billing.issuer.update.global',
    'billing.issuance.create.workspace',
    'billing.delivery.create.workspace',
    'billing.cancellation.create.workspace',
    'billing.pac.update.global',
    'security.settings.update.global',
  ];
  assert.deepEqual(delegatedPolicies(policies, ['directory:read']), [
    'directory.contact.view.global',
  ]);
  assert.deepEqual(delegatedPolicies(policies, ['documents:upload']), [
    'documents.workspace.create.global',
  ]);
  assert.deepEqual(delegatedPolicies(policies, ['projects:write']), [
    'projects.project.update.global',
  ]);
  assert.deepEqual(delegatedPolicies(policies, ['projects:catalog']), [
    'projects.project-type.update.global',
  ]);
  assert.deepEqual(delegatedPolicies(policies, ['billing:issue', 'billing:send']), [
    'billing.issuance.create.workspace',
    'billing.delivery.create.workspace',
  ]);
  assert.deepEqual(delegatedPolicies(policies, ['billing:issuers']), [
    'billing.issuer.update.global',
  ]);
  assert.deepEqual(delegatedPolicies(policies, ['billing:cancel']), [
    'billing.cancellation.create.workspace',
  ]);
}
test(
  'el consentimiento distingue Directorio, Documentos, Proyectos y operaciones fiscales',
  extendedScopes,
);
test('Comunicación distingue consulta, envío, archivos y Timeline y resuelve su principal sin sesión web' /** @returns {Promise<void>} Conserva capacidades separadas y permisos vigentes por concesión. */, async () => {
  const { delegatedPolicies } = require('../server/modules/oauth/policies/oauth-scope.policy');
  const policies              = [
    'communication.chat.view.global',
    'communication.chat.create.global',
    'communication.timeline.view.workspace',
    'communication.timeline.create.workspace',
    'security.settings.update.global',
  ];
  assert.deepEqual(delegatedPolicies(policies, ['communication:read']), [policies[0]]);
  assert.deepEqual(delegatedPolicies(policies, ['communication:send']), policies.slice(0, 2));
  assert.deepEqual(delegatedPolicies(policies, ['communication:read-state']), [policies[0]]);
  assert.deepEqual(delegatedPolicies(policies, ['communication:download']), [
    policies[0],
    policies[2],
  ]);
  assert.deepEqual(
    delegatedPolicies(policies, ['communication:timeline-write']),
    policies.slice(2, 4),
  );
  const f = fixture();
  f.state.policies.W1 = policies;
  await f.grant({
    scopes     : ['communication:send', 'communication:timeline-write'],
    workspaces : ['W1'],
  });
  const principal = await f.service.resolve(
    {
      grantCode : 'G1',
      clientId  : 'C1',
      workspace : 'W1',
    },
    'service-communication',
  );
  assert.deepEqual(principal.scopes, ['communication:send', 'communication:timeline-write']);
  assert.equal(principal.policies.includes('security.settings.update.global'), false);
  f.state.policies.W1 = [];
  assert.deepEqual(
    (
      await f.service.resolve(
        {
          grantCode : 'G1',
          clientId  : 'C1',
          workspace : 'W1',
        },
        'service-communication',
      )
    ).scopes,
    ['communication:timeline-write'],
  );
});
test('concesiones anteriores reautorizan únicamente Projects y el modelo nuevo conserva scopes como techo', /** @returns {Promise<void>} No revoca Customer ni mantiene un camino alternativo mediante grupos Projects. */ async () => {
  const f = fixture();
  f.state.policies.W1 = ['customer.customer.view.global', 'projects.project.view.global'];
  const scopes = ['customer:read', 'projects:read', 'projects:write', 'projects:delete'];
  await f.grant({ scopes });
  delete f.grants.get('G1').projectsAuthorization;
  const legacy = await f.service.resolve(
    {
      grantCode : 'G1',
      clientId  : 'C1',
      workspace : 'W1',
    },
    'service-apigateway',
  );
  assert.equal(legacy.projectsAuthorization, 'legacy');
  assert.deepEqual(legacy.scopes, ['customer:read']);
  await f.grant({
    grantCode : 'G2',
    scopes,
  });
  f.state.policies.W1 = ['customer.customer.view.global'];
  const current = await f.service.resolve(
    {
      grantCode : 'G2',
      clientId  : 'C1',
      workspace : 'W1',
    },
    'service-apigateway',
  );
  assert.equal(current.projectsAuthorization, 'team');
  assert.deepEqual(current.scopes, scopes);
  assert.deepEqual(current.policies, ['customer.customer.view.global']);
  assert.deepEqual(
    (
      await f.service.resolve(
        {
          grantCode : 'G1',
          clientId  : 'C1',
          workspace : 'W1',
        },
        'service-apigateway',
      )
    ).scopes,
    ['customer:read'],
  );
});

test('Platform sólo consulta conexiones propias de una sesión humana y no administra consentimiento', /** @returns {Promise<void>} El origen de lectura no amplía los comandos privados del Gateway. */ async () => {
  const f = fixture();
  await f.grant();
  const result = await f.service.grantList({ page: 1 }, 'service-platform');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].revision, 1);
  assert.equal(Object.hasOwn(result.items[0], 'userCode'), false);
  await assert.rejects(f.service.grantRevoke({ grantCode: 'G1' }, 'service-platform'), {
    statusCode : 403,
  });
  await assert.rejects(f.service.grantList({}, 'service-connect'), { statusCode: 403 });
  f.state.userCode = 'other';
  assert.deepEqual(await f.service.grantList({}, 'service-platform'), { items: [] });
  f.state.actor = { delegation: { grantCode: 'G1' } };
  await assert.rejects(f.service.grantList({}, 'service-platform'), { statusCode: 403 });
});
