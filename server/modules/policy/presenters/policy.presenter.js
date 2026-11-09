/** @file Representación pública canónica de políticas y sus metadatos de acceso. */
'use strict';
const { publicRecord } = require('../../../shared/public-record');
const POLICY_FIELDS    = Object.freeze([
  '_id',
  'revision',
  'policyCode',
  'workspace',
  'userCreate',
  'userAssigned',
  'identifier',
  'service',
  'section',
  'description',
  'active',
  'root',
  'base',
  'updateDate',
  'creationDate',
  'idTransaction',
  'erased',
]);

/**
 * Selecciona los campos públicos de una política ya autorizada.
 * @param {Object|null} record Registro de aplicación completo o parcial.
 * @returns {Object|null} Política pública sin datos adicionales de persistencia, o null.
 */
function policyPresenter(record) {
  return publicRecord(record, POLICY_FIELDS);
}

module.exports = {
  POLICY_FIELDS,
  policyPresenter,
};
