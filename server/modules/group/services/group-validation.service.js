/** @file Validación de nombres y nuevas asociaciones de políticas de grupos; conserva entradas, resultados, errores y efectos existentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function groupValidationService({ ApplicationError, readPolicy }) {
  /**
   * Ejecuta validName dentro del flujo de group.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  function validName(value) {
    if (typeof value !== 'string' || !value.trim())
      throw new ApplicationError(400, 'GROUP_NAME_REQUIRED');
    return value.trim();
  }
  /**
   * Ejecuta validPolicies dentro del flujo de group.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @param {*} [previous] Valor de previous utilizado por esta operación.
   * @returns {Promise<Array<*>>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function validPolicies(value, previous = []) {
    if (
      !Array.isArray(value) ||
      value.some(
        /**
         * Comprueba si el elemento satisface la condición.
         * @param {string} code Identificador público del recurso.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (code) => typeof code !== 'string' || !code.trim() || code !== code.trim(),
      ) ||
      new Set(value).size !== value.length
    )
      throw new ApplicationError(400, 'INVALID_GROUP_POLICIES');
    for (const code of value.filter(
      /**
       * Determina si el elemento cumple el criterio de selección.
       * @param {string} code Identificador público del recurso.
       * @returns {boolean} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (code) => !previous.includes(code),
    )) {
      // Sólo las nuevas asociaciones necesitan una consulta autorizada y una política activa.
      const policy = await readPolicy({
        policyCode : code,
        active     : true,
        erased     : false,
      });
      if (!policy) throw new ApplicationError(400, 'GROUP_POLICY_UNAVAILABLE');
    }
    return [...value];
  }
  return {
    validName,
    validPolicies,
  };
}
module.exports = { groupValidationService };
