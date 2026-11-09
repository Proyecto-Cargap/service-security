/** @file Lectura interna acotada de autorización por códigos explícitos, sin paginación ni conteos administrativos. */
'use strict';
const { ApplicationError } = require('../../shared/application-error');

/** Compone una capacidad exclusivamente interna con proyección fija y límite de cardinalidad.
 * @param {Object} options Modelo, política, contexto, campo de códigos y proyección mínima.
 * @returns {Function} Lee registros actuales; nunca conserva permisos entre solicitudes.
 */
function accessRead({ model, policy, messaging, codeField, fields }) {
  /** @param {Object} filter Códigos explícitos y condiciones de vigencia/workspace.
   * @param {symbol} scope Marcador interno de la política del recurso.
   * @returns {Promise<Object[]>} Registros mínimos; falla cerrado ante exceso o denegación.
   */
  return async function readAccess(filter, scope) {
    if (scope !== policy.trustedScopes.guest) throw new ApplicationError(403, 'FORBIDDEN');
    const codes = filter?.[codeField]?.$in;
    if (
      !Array.isArray(codes) ||
      codes.length > 10000 ||
      codes.some(
        /** @param {*} code Código interno. @returns {boolean} Indica un identificador inválido. */
        (code) => typeof code !== 'string' || !code || code.length > 100,
      )
    )
      throw new ApplicationError(400, 'INVALID_ACCESS_CODES');
    const authorized = policy.authorize('view', filter, scope, messaging.getContext());
    if (!authorized) throw new ApplicationError(403, 'FORBIDDEN');
    if (!codes.length) return [];
    const limit = new Set(codes).size;
    const rows  = await model
      .find(authorized, fields)
      .limit(limit + 1)
      .lean();
    if (rows.length > limit) throw new ApplicationError(409, 'ACCESS_CARDINALITY_CHANGED');
    return rows;
  };
}
module.exports = { accessRead };
