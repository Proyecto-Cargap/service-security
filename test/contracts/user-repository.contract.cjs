/** @file Conformidad reutilizable de persistencia de usuarios: datos simples, ausencia, proyección, orden, validación y bajas. */
'use strict';
const assert            = require('node:assert/strict');
const { trustedScopes } = require('../../server/modules/user/policies/user.policy');

/**
 * Verifica un contrato observable del repositorio sin depender de un modelo ni de su conexión.
 * El ejecutor debe proporcionar un almacenamiento aislado y vacío para el prefijo contract-user-.
 * @param {Object} repository Implementación de persistencia de usuarios bajo prueba.
 * @returns {Promise<void>} Finaliza al acreditar lectura, escritura, orden y representación de datos.
 */
async function verifyUserRepository(repository) {
  const scope  = trustedScopes.guest;
  const filter = { userCode: { $in: ['contract-user-a', 'contract-user-b'] } };
  assert.equal(await repository.getOne({ userCode: 'contract-user-missing' }, scope), null);
  for (const suffix of ['b', 'a']) {
    const code   = `contract-user-${suffix}`;
    const record = await repository.create(
      {
        userCode     : code,
        user         : `${code}@example.invalid`,
        workspace    : 'w',
        userCreate   : '',
        userAssigned : '',
        password     : 'private-fixture',
        state        : 'active',
        validity     : Date.now() + 60000,
      },
      scope,
    );
    assert.equal(record.userCode, code);
    assert.equal(record.password, 'private-fixture');
    assert.equal(typeof record._id, 'string');
    assert.equal(Object.getPrototypeOf(record), Object.prototype);
    assert.equal(record.save, undefined);
  }
  const first  = await repository.getList(filter, { userCode: 1 }, 0, 1, '', scope);
  const second = await repository.getList(filter, { userCode: 1 }, 1, 1, '', scope);
  assert.equal(first.totalCount, 2);
  assert.equal(second.totalCount, 2);
  assert.equal(first.listItem[0].userCode, 'contract-user-a');
  assert.equal(second.listItem[0].userCode, 'contract-user-b');
  assert.equal(first.listItem[0].toObject, undefined);
  const references = await repository.getReferences(['contract-user-a'], 'userCode', scope);
  assert.equal(references[0].userCode, 'contract-user-a');
  assert.equal(references[0].password, undefined);
  assert.equal(typeof references[0]._id, 'string');
  const saved = await repository.update(
    { userCode: 'contract-user-a' },
    { $set: { state: 'inactive' } },
    scope,
  );
  assert.equal(saved.state, 'inactive');
  assert.equal(saved.toJSON, undefined);
  saved.groups = ['g'];
  const changed = await repository.updateItem(saved, scope);
  assert.deepEqual(changed.groups, ['g']);
  assert.equal(changed.save, undefined);
  assert.equal(
    await repository.update(
      { userCode: 'contract-user-missing' },
      { $set: { state: 'inactive' } },
      scope,
    ),
    null,
  );
  await assert.rejects(
    repository.update({ userCode: 'contract-user-a' }, { $set: { state: 'invalid' } }, scope),
  );
  assert.equal((await repository.getOne({ userCode: 'contract-user-a' }, scope)).state, 'inactive');
  assert.equal(
    (await repository.deleteOne({ userCode: 'contract-user-a' }, true, scope)).erased,
    true,
  );
  assert.equal(
    (await repository.deleteOne({ userCode: 'contract-user-b' }, false, scope)).userCode,
    'contract-user-b',
  );
  assert.equal(await repository.getOne({ userCode: 'contract-user-b' }, scope), null);
}

module.exports = { verifyUserRepository };
