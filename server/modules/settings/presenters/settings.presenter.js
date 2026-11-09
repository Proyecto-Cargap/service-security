/** @file Proyección pública del catálogo canónico de configuración de Security. */
'use strict';
const { publicRecord }     = require('../../../shared/public-record');
const { PARAMETERS }       = require('../contracts/settings.contract');
const { ApplicationError } = require('../../../shared/application-error');
const SETTING_FIELDS       = Object.freeze([
  '_id',
  'workspace',
  'userCreate',
  'userAssigned',
  'parameter',
  'revision',
]);

/**
 * Selecciona los campos públicos del parámetro y los campos editables de su contenido conocido.
 * @param {Object|null} record Registro autorizado de configuración, sin métodos de persistencia.
 * @returns {Object|null} Parámetro público; los campos ausentes conservan su ausencia.
 */
function settingsPresenter(record) {
  const result = publicRecord(record, SETTING_FIELDS);
  if (record && !Object.hasOwn(PARAMETERS, record.parameter))
    throw new ApplicationError(500, 'INVALID_SETTINGS_RECORD');
  if (!result || record.data === undefined) return result;
  result.data =
    record.data && typeof record.data === 'object' && !Array.isArray(record.data)
      ? publicRecord(record.data, PARAMETERS[record.parameter])
      : record.data;
  return result;
}

module.exports = {
  SETTING_FIELDS,
  settingsPresenter,
};
