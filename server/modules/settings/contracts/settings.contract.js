/** @file Parámetros canónicos de configuración y validación de duraciones de los tokens JWT. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
const ms                   = require('ms');
const PARAMETERS           = Object.freeze({
  'session-setings' : ['multisession', 'tokenSessionExpiration', 'maximumFailedAttempts'],
  'user-setings'    : ['tokenNotificationExpiration', 'defaultGroupsByRole'],
});

/** Valida el arreglo cerrado de asignaciones, sin consultar catálogos.
 * @param {unknown} value Asignaciones recibidas o persistidas.
 * @returns {void} Rechaza estructura, códigos vacíos y duplicados.
 */
function validateDefaultGroupsByRole(value) {
  if (!Array.isArray(value) || value.length > 10000)
    throw new ApplicationError(400, 'INVALID_DEFAULT_GROUPS');
  const roles = new Set();
  for (const row of value) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      Object.keys(row).some(
        /** @param {string} key Campo recibido. @returns {boolean} Campo ajeno al contrato. */
        (key) => !['roleCode', 'groupCodes'].includes(key),
      ) ||
      typeof row.roleCode !== 'string' ||
      !row.roleCode.trim() ||
      row.roleCode !== row.roleCode.trim() ||
      row.roleCode.length > 4096 ||
      roles.has(row.roleCode) ||
      !Array.isArray(row.groupCodes) ||
      row.groupCodes.length > 10000
    )
      throw new ApplicationError(400, 'INVALID_DEFAULT_GROUPS');
    roles.add(row.roleCode);
    const groups = new Set();
    for (const code of row.groupCodes) {
      if (
        typeof code !== 'string' ||
        !code.trim() ||
        code !== code.trim() ||
        code.length > 4096 ||
        groups.has(code)
      )
        throw new ApplicationError(400, 'INVALID_DEFAULT_GROUPS');
      groups.add(code);
    }
  }
}
/**
 * Ejecuta durationSeconds dentro del flujo de settings.contract.
 * @param {*} value Valor de value utilizado por esta operación.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function durationSeconds(value) {
  const seconds =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? value
      : typeof value === 'string' && value.length <= 100
        ? ms(value) / 1000
        : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}
/**
 * Comprueba las condiciones de validateChanges antes de continuar.
 * @param {*} parameter Valor de parameter utilizado por esta operación.
 * @param {Object} data Datos de entrada de la operación.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function validateChanges(parameter, data) {
  if (!Object.hasOwn(PARAMETERS, parameter)) throw new ApplicationError(400, 'INVALID_PARAMETER');
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new ApplicationError(400, 'INVALID_SETTINGS');
  for (const [key, value] of Object.entries(data)) {
    if (!PARAMETERS[parameter].includes(key))
      throw new ApplicationError(400, 'INVALID_SETTINGS_FIELD');
    if (key === 'defaultGroupsByRole') {
      validateDefaultGroupsByRole(value);
      continue;
    }
    if (
      key === 'multisession'
        ? typeof value !== 'boolean'
        : key === 'maximumFailedAttempts'
          ? !Number.isSafeInteger(value) || value <= 0
          : durationSeconds(value) === null
    )
      throw new ApplicationError(400, 'INVALID_SETTINGS');
  }
  return data;
}
module.exports = {
  PARAMETERS,
  durationSeconds,
  validateChanges,
  validateDefaultGroupsByRole,
};
