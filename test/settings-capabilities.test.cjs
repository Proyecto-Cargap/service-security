/** @file Contratos de lectura y modificación de configuración y referencias con colaboradores mínimos. */
'use strict';
const test                     = require('node:test');
const assert                   = require('node:assert/strict');
const { settingsService }      = require('../server/modules/settings/services/settings.service');
const { userReferenceService } = require('../server/modules/user/services/user-reference.service');
const { ApplicationError }     = require('../server/shared/application-error');

/**
 * Acredita que leer parámetros no exige capacidades de escritura ni mensajería.
 * @returns {Promise<void>} Finaliza al preservar datos y errores públicos del contrato anterior.
 */
async function verifySettingsReads() {
  const record = {
    parameter : 'user-setings',
    data      : { tokenNotificationExpiration: '1d' },
  };
  /** @returns {Promise<Object>} Registro de configuración autorizado. */
  async function get() {
    return record;
  }
  /** @returns {Promise<Object[]>} Colección completa de parámetros visibles. */
  async function getAll() {
    return [
      record,
      {
        parameter : 'removed-parameter',
        data      : { obsolete: true },
      },
    ];
  }
  const service = settingsService({
    settings : {
      get,
      getAll,
    },
  });
  assert.equal(await service.getOne({ parameter: record.parameter }), record);
  assert.deepEqual(
    await service.getList({
      page    : '1',
      perPage : 20,
    }),
    [record],
  );
  /** @param {Error} error Error de obligatoriedad del parámetro.
   * @returns {boolean} Conserva estado y código públicos históricos.
   */
  function requiredParameter(error) {
    return (
      error.statusCode === 400 && error.descriptionCode === 'N0001-C000-E0001:Parameter is required'
    );
  }
  await assert.rejects(service.getOne({}), requiredParameter);
  await assert.rejects(service.getOne({ parameter: 'removed-parameter' }), {
    statusCode      : 400,
    descriptionCode : 'INVALID_PARAMETER',
  });
  await assert.rejects(service.getList({ page: 0 }), {
    statusCode      : 400,
    descriptionCode : 'INVALID_PAGINATION',
  });
}

/** @returns {Promise<void>} La escritura y su evento pertenecen al puerto transaccional; el servicio no publica un segundo aviso. */
async function verifySettingsEffects() {
  let writes = 0;
  let failure;
  const service = settingsService({
    settings : {
      /** @returns {Promise<Object>} Confirma o rechaza la unidad atómica. */
      async update() {
        writes++;
        if (failure) throw failure;
        return { parameter: 'user-setings' };
      },
    },
  });
  await service.update({
    parameter : 'user-setings',
    data      : {},
  });
  assert.equal(writes, 1);
  failure = new ApplicationError(503, 'PUBLICATION_UNAVAILABLE');
  await assert.rejects(
    service.update({
      parameter : 'user-setings',
      data      : {},
    }),
    failure,
  );
  assert.equal(writes, 2);
  assert.equal(failure.uncertain, undefined);
  await assert.rejects(service.update({ parameter: 'user-setings' }), { statusCode: 400 });
  assert.equal(writes, 2);
}

/**
 * Acredita la consulta de integridad con una capacidad única y sin devolver usuarios.
 * @returns {Promise<void>} Finaliza al comprobar entrada y propagación de errores.
 */
async function verifyReferences() {
  const calls = [];
  /** @param {string} code Rol cuya integridad se comprueba.
   * @returns {Promise<boolean>} Existencia de referencias sin identidades ni conteos.
   */
  async function hasRoleReference(code) {
    calls.push(code);
    return true;
  }
  const service = userReferenceService({ userReferences: { hasRoleReference } });
  assert.deepEqual(
    await service.exists({
      kind : 'role',
      code : 'r',
    }),
    { used: true },
  );
  assert.deepEqual(calls, ['r']);
  await assert.rejects(
    service.exists({
      kind : 'other',
      code : 'r',
    }),
    { statusCode: 400 },
  );
  assert.deepEqual(calls, ['r']);
}

test(
  'la consulta de configuración usa un lector mínimo y conserva los errores públicos',
  verifySettingsReads,
);
test(
  'la configuración exige una escritura atómica y no publica avisos duplicados',
  verifySettingsEffects,
);
test(
  'la integridad de roles funciona con un puerto mínimo sin proyecciones de usuarios',
  verifyReferences,
);
