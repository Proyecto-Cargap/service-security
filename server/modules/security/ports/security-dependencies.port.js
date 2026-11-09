/** @file Contrato de construcción de capacidades técnicas de Security; no importa implementaciones. */
'use strict';

const { REPOSITORY_CAPABILITIES } = require('./security-repositories.port');
const { PICTURE_CAPABILITIES }    = require('./security-pictures.port');

/** Verifica capacidades requeridas antes de registrar acciones; nunca invoca sus métodos.
 * Los métodos conservan sus errores originales; la validación no reintenta ni produce efectos.
 * @param {Object} value Colaborador cuya implementación puede sustituirse.
 * @param {string[]} methods Operaciones mínimas exigidas por el consumidor.
 * @param {string} name Nombre diagnóstico del colaborador, sin datos privados.
 * @returns {Object} La misma instancia, sin envolver métodos ni alterar su identidad.
 * @throws {TypeError} Cuando falta una operación obligatoria.
 */
function requireCapability(value, methods, name) {
  for (const method of methods) {
    if (typeof value?.[method] !== 'function')
      throw new TypeError(`INVALID_CAPABILITY:${name}.${method}`);
  }
  return value;
}

/** Valida las capacidades de firma y persistencia utilizadas por las acciones de Security.
 * Repositorios: getOne resuelve un registro o null; getList conserva orden y paginación declarados.
 * Las operaciones de escritura propagan los conflictos y respetan la sesión transaccional recibida.
 * JWT y hash mantienen la semántica vigente; no se generan tokens ni hashes durante esta validación.
 * @param {Object} dependencies Dependencias ya construidas por la composición.
 * @returns {Object} Las dependencias verificadas, con sus identidades originales.
 */
function validateSecurityDependencies(dependencies) {
  requireCapability(dependencies.jwt, ['sign', 'verify', 'decode'], 'jwt');
  requireCapability(dependencies.passwordHasher, ['hash', 'compare'], 'passwordHasher');
  for (const [name, methods] of Object.entries(REPOSITORY_CAPABILITIES))
    requireCapability(dependencies.repositories?.[name], methods, name);
  requireCapability(dependencies.settings, ['get', 'getAll', 'update'], 'settings');
  requireCapability(dependencies.counter, ['getObjectCode'], 'counter');
  requireCapability(dependencies.workspacePictures, PICTURE_CAPABILITIES, 'workspacePictures');
  requireCapability(
    dependencies.messaging,
    [
      'getContext',
      'request',
      'sendCommand',
      'publishEvent',
      'transaction',
      'registerAction',
      'successResponse',
      'errorResponse',
    ],
    'messaging',
  );
  for (const name of [
    'user',
    'session',
    'group',
    'policy',
    'workspaces',
    'settings',
    'userReference',
  ]) {
    if (typeof dependencies.services?.[name] !== 'function')
      throw new TypeError(`INVALID_CAPABILITY:services.${name}`);
  }
  if (typeof dependencies.roleLabels !== 'function')
    throw new TypeError('INVALID_CAPABILITY:roleLabels');
  if (typeof dependencies.tokenSecret !== 'string' || !dependencies.tokenSecret.trim())
    throw new TypeError('INVALID_CONFIGURATION:tokenSecret');
  return dependencies;
}
module.exports = {
  REPOSITORY_CAPABILITIES,
  requireCapability,
  validateSecurityDependencies,
};
