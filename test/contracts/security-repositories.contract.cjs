/** @file Suite común de persistencia de Security: datos simples, ausencia, autorización, orden, validación y baja. */
'use strict';
const assert = require('node:assert/strict');

/**
 * Verifica un repositorio de recursos con la misma suite observable, sin acceder a documentos del modelo.
 * @param {Object} input Repositorio, alcance interno, campo de código y datos válidos del recurso.
 * @returns {Promise<void>} Finaliza al acreditar representación y comportamiento de lectura y escritura.
 */
async function verifyResourceRepository({
  repository,
  scope,
  codeField,
  data,
  mutableField,
  changedValue,
  requiredField,
}) {
  const filter = { [codeField]: { $in: ['contract-a', 'contract-b'] } };
  assert.equal(await repository.getOne({ [codeField]: 'contract-missing' }, scope), null);
  for (const suffix of ['b', 'a']) {
    const record = await repository.create(
      {
        ...data,
        [codeField]  : `contract-${suffix}`,
        ...(codeField === 'sessionCode' ? { token: `contract-token-${suffix}` } : {}),
        workspace    : 'w',
        userCreate   : '',
        userAssigned : '',
      },
      scope,
    );
    assert.equal(record[codeField], `contract-${suffix}`);
    assert.equal(typeof record._id, 'string');
    assert.equal(Object.getPrototypeOf(record), Object.prototype);
    assert.equal(record.save, undefined);
    assert.equal(record.toObject, undefined);
  }
  const first  = await repository.getList(filter, { [codeField]: 1 }, 0, 1, '', scope);
  const second = await repository.getList(filter, { [codeField]: 1 }, 1, 1, '', scope);
  assert.equal(first.totalCount, 2);
  assert.equal(second.totalCount, 2);
  assert.equal(first.listItem[0][codeField], 'contract-a');
  assert.equal(second.listItem[0][codeField], 'contract-b');
  assert.equal(first.listItem[0].toJSON, undefined);
  const saved = await repository.update(
    { [codeField]: 'contract-a' },
    { $set: { [mutableField]: changedValue } },
    scope,
  );
  assert.deepEqual(saved[mutableField], changedValue);
  assert.equal(saved.toObject, undefined);
  const changed = await repository.updateItem(saved, scope);
  assert.deepEqual(changed[mutableField], changedValue);
  assert.equal(typeof changed._id, 'string');
  assert.equal(
    await repository.update(
      { [codeField]: 'contract-missing' },
      { $set: { [mutableField]: changedValue } },
      scope,
    ),
    null,
  );
  await assert.rejects(
    repository.update({ [codeField]: 'contract-a' }, { $unset: { [requiredField]: 1 } }, scope),
  );
  assert.deepEqual(
    (await repository.getOne({ [codeField]: 'contract-a' }, scope))[mutableField],
    changedValue,
  );
  assert.equal(
    (await repository.deleteOne({ [codeField]: 'contract-a' }, true, scope)).erased,
    true,
  );
  assert.equal(
    (await repository.deleteOne({ [codeField]: 'contract-b' }, false, scope))[codeField],
    'contract-b',
  );
  assert.equal(await repository.getOne({ [codeField]: 'contract-b' }, scope), null);
}

/**
 * Compone implementaciones Mongoose únicamente dentro del entorno aislado de integración.
 * @param {Object} messaging Mensajería local cuyo contexto transaccional no alcanza sistemas externos.
 * @returns {Promise<void>} Finaliza al ejecutar el mismo contrato para grupos, políticas, workspaces y sesiones.
 */
async function verifySecurityRepositories(messaging) {
  const userModel      = require('../../server/modules/user/models/user.model');
  const sessionModel   = require('../../server/modules/session/models/session.model');
  const groupModel     = require('../../server/modules/group/models/group.model');
  const policyModel    = require('../../server/modules/policy/models/policy.model');
  const workspaceModel = require('../../server/modules/workspaces/models/workspaces.model');
  const entries        = [
    {
      repository    : require('../../server/modules/group/repositories/group.repository')({
        model : groupModel,
        userModel,
        messaging,
      }),
      scope         : require('../../server/modules/group/policies/group.policy').trustedScopes.guest,
      codeField     : 'groupCode',
      data          : { name: 'Group' },
      mutableField  : 'name',
      changedValue  : 'Changed',
      requiredField : 'name',
    },
    {
      repository    : require('../../server/modules/policy/repositories/policy.repository')({
        model : policyModel,
        groupModel,
        messaging,
      }),
      scope         : require('../../server/modules/policy/policies/policy.policy').trustedScopes.guest,
      codeField     : 'policyCode',
      data          : {
        identifier  : 'fixture.read',
        description : 'Policy',
        service     : 'fixture',
        section     : 'fixture',
      },
      mutableField  : 'description',
      changedValue  : 'Changed',
      requiredField : 'identifier',
    },
    {
      repository    : require('../../server/modules/workspaces/repositories/workspaces.repository')({
        model : workspaceModel,
        userModel,
        sessionModel,
        groupModel,
        policyModel,
        messaging,
      }),
      scope         : require('../../server/modules/workspaces/policies/workspaces.policy').trustedScopes
        .guest,
      codeField     : 'workspaceCode',
      data          : { name: 'Workspace' },
      mutableField  : 'name',
      changedValue  : 'Changed',
      requiredField : 'name',
    },
    {
      repository    : require('../../server/modules/session/repositories/session.repository')({
        model : sessionModel,
        messaging,
      }),
      scope         : require('../../server/modules/session/policies/session.policy').trustedScopes.guest,
      codeField     : 'sessionCode',
      data          : {
        userCode        : 'contract-user',
        activeWorkspace : 'w',
        expiration      : Date.now() / 1000 + 600,
        active          : true,
      },
      mutableField  : 'active',
      changedValue  : false,
      requiredField : 'token',
    },
  ];
  for (const entry of entries) await verifyResourceRepository(entry);
  const settings      = require('../../server/modules/settings/repositories/settings.repository')({
    model : require('../../server/modules/settings/models/settings.model'),
    messaging,
  });
  const settingsScope = require('../../server/modules/settings/policies/settings.policy')
    .trustedScopes.guest;
  const created       = await settings.create(
    'user-setings',
    { tokenNotificationExpiration: '1d' },
    settingsScope,
  );
  assert.equal(created.parameter, 'user-setings');
  assert.equal(created.save, undefined);
  const updated = await settings.update(
    'user-setings',
    { tokenNotificationExpiration: 3600 },
    settingsScope,
  );
  assert.equal(updated.toObject, undefined);
  assert.equal(
    (await settings.get('user-setings', settingsScope)).data.tokenNotificationExpiration,
    3600,
  );
  const items = await settings.getAll(settingsScope);
  assert.equal(items.length, 1);
  assert.equal(typeof items[0]._id, 'string');
  await assert.rejects(settings.update('user-setings', { unknown: true }, settingsScope));
  const countersModel = require('../../server/modules/counters/models/counters.model');
  await countersModel.init();
  const counters     = require('../../server/modules/counters/repositories/counters.repository')({
    model : countersModel,
  });
  const pendingCodes = [];
  for (let index = 0; index < 32; index++)
    pendingCodes.push(counters.getObjectCode('SOLID', 'code'));
  const allocated = (await Promise.all(pendingCodes)).sort();
  assert.equal(new Set(allocated).size, 32);
  assert.equal(allocated[0], 'SOLID0000000');
  assert.equal(allocated[31], 'SOLID0000031');
  const identifier = await counters.getObjectCode('SOLID');
  assert.match(identifier, /^SOLID-[a-f0-9-]{36}$/);
  assert.equal((await countersModel.findById('SOLID')).seq, 31);
  await require('./agent-lifecycle.contract.cjs').verifyAgentLifecycle({
    repositories   : {
      user       : require('../../server/modules/user/repositories/user.repository')({
        model : userModel,
        messaging,
      }),
      session    : entries[3].repository,
      group      : entries[0].repository,
      policy     : entries[1].repository,
      workspaces : entries[2].repository,
    },
    messaging,
    workspaceScope : entries[2].scope,
  });
}

module.exports = {
  verifyResourceRepository,
  verifySecurityRepositories,
};
