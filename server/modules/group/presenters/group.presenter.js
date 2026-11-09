/** @file Representación pública canónica de grupos; excluye propiedades que no pertenecen al contrato del recurso. */
'use strict';
const { publicRecord } = require('../../../shared/public-record');
const GROUP_FIELDS     = Object.freeze([
  '_id',
  'revision',
  'groupCode',
  'workspace',
  'userCreate',
  'userAssigned',
  'name',
  'policies',
  'root',
  'updateDate',
  'creationDate',
  'idTransaction',
  'erased',
]);

/**
 * Presenta el grupo autorizado sin ejecutar efectos ni resolver referencias externas.
 * @param {Object|null} record Registro de aplicación completo o parcial.
 * @returns {Object|null} Campos públicos definidos del grupo, o null cuando está ausente.
 */
function groupPresenter(record) {
  return publicRecord(record, GROUP_FIELDS);
}

module.exports = {
  GROUP_FIELDS,
  groupPresenter,
};
