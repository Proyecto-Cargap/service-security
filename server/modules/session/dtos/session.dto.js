/** @file Representación administrativa positiva de sesiones, sin tokens ni permisos. */
'use strict';
const FIELDS = Object.freeze([
  'sessionCode',
  'revision',
  'userCode',
  'roleCode',
  'workspace',
  'userCreate',
  'userAssigned',
  'activeWorkspace',
  'active',
  'start',
  'lastAccess',
  'expiration',
  'end',
  'updateDate',
]);
/**
 * Ejecuta sessionDTO dentro del flujo de session.dto.
 * @param {*} document Valor de document utilizado por esta operación.
 * @param {*} [now] Valor de now utilizado por esta operación.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function sessionDTO(document, now = Date.now()) {
  if (!document) return null;
  const source = document;
  const item   = Object.fromEntries(
    FIELDS.filter(
      /**
       * Determina si el elemento cumple el criterio de selección.
       * @param {string} key Clave del campo o recurso que se procesa.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (key) => source[key] !== undefined,
    ).map(
      /**
       * Proyecta cada elemento en la estructura requerida por la operación.
       * @param {string} key Clave del campo o recurso que se procesa.
       * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (key) => [key, source[key]],
    ),
  );
  item.state = !source.active
    ? 'closed'
    : !Number.isFinite(Number(source.expiration)) || Number(source.expiration) * 1000 <= now
      ? 'expired'
      : 'active';
  return item;
}
/**
 * Ejecuta sessionListDTO dentro del flujo de session.dto.
 * @param {*} document Valor de document utilizado por esta operación.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function sessionListDTO(document) {
  return {
    ...sessionDTO(document),
    user     : typeof document.user === 'string' && document.user.trim() ? document.user.trim() : null,
    roleName :
      typeof document.roleName === 'string' && document.roleName.trim()
        ? document.roleName.trim()
        : null,
  };
}
module.exports = {
  FIELDS,
  sessionDTO,
  sessionListDTO,
};
