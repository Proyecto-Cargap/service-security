/** @file Regresiones de recuperación de imágenes: conserva referencias activas y señala efectos de almacenamiento sin confirmar. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  workspacePictureRecoveryService,
} = require('../server/modules/workspaces/services/workspace-picture-recovery.service');

/** @returns {Promise<void>} Una lectura de workspace no exige almacenamiento ni produce escrituras. */
async function verifyReadWithoutCleanup() {
  const record  = {
    workspaceCode  : 'w',
    pictureCleanup : ['old'],
  };
  const service =
    require('../server/modules/workspaces/services/workspaces-queries-workflow.service').workspacesQueriesWorkflowService(
      {
        ApplicationError     : require('../server/shared/application-error').ApplicationError,
        workspacesState      : {},
        workspacesRepository : {
          /** @returns {Promise<Object>} Registro autorizado. */
          async getOne() {
            return record;
          },
        },
      },
    );
  assert.equal(await service.getOne({ workspaceCode: 'w' }), record);
}

/**
 * Verifica el resultado observable cuando la escritura o la limpieza anterior no pueden confirmarse.
 * @returns {Promise<void>} Finaliza tras conservar la imagen referenciada y señalar incertidumbre cuando corresponde.
 */
async function verifyUploadRecovery() {
  const uploaded     = { pictureFile: { id: 'new' } };
  let current        = { pictureFile: { id: 'new' } };
  let storageRemoved = true;
  let unavailable    = false;
  const removals     = [];
  /** @returns {Promise<Object|null>} Referencia persistida de la imagen o fallo explícito de disponibilidad. */
  async function getOne() {
    if (unavailable) throw new Error('fixture-unavailable');
    return current;
  }
  /** @param {string} fileId Imagen exclusiva de la carga que se intenta recuperar.
   * @returns {Promise<boolean>} Confirmación de limpieza que nunca se sustituye por un éxito implícito.
   */
  async function remove(fileId) {
    removals.push(fileId);
    return storageRemoved;
  }
  const service = workspacePictureRecoveryService({
    pictures             : { remove },
    workspacesRepository : { getOne },
    workspacesScopes     : {},
  });
  assert.equal(await service.recoverUpload(uploaded, 'w', new Error('fixture-write')), true);
  assert.deepEqual(removals, []);
  current = null;
  const definitive = new Error('fixture-write');
  assert.equal(await service.recoverUpload(uploaded, 'w', definitive), false);
  assert.equal(definitive.uncertain, undefined);
  assert.deepEqual(removals, ['new']);
  storageRemoved = false;
  const pending = new Error('fixture-write');
  assert.equal(await service.recoverUpload(uploaded, 'w', pending), false);
  assert.equal(pending.uncertain, true);
  unavailable = true;
  const unknown = new Error('fixture-write');
  assert.equal(await service.recoverUpload(uploaded, 'w', unknown), false);
  assert.equal(unknown.uncertain, true);
}

test('la lectura conserva pendientes sin ejecutar efectos de limpieza', verifyReadWithoutCleanup);
test(
  'la recuperación distingue persistencia confirmada, limpieza e incertidumbre',
  verifyUploadRecovery,
);
