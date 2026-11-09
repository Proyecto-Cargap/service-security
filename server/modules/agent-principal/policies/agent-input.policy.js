/** @file Validación de identificadores y autorización del origen de identidades de agentes; conserva entradas, resultados, errores y efectos existentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function agentInputPolicy({ ApplicationError }) {
  /**
   * Ejecuta code dentro del flujo de agent-principal.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const code   = (value) =>
    typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/.test(value);
  /**
   * Ejecuta codes dentro del flujo de agent-principal.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const codes  = (value) =>
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(code) &&
    new Set(value).size === value.length;
  /**
   * Ejecuta origin dentro del flujo de agent-principal.service.
   * @param {string} source Valor de source utilizado por esta operación.
   * @param {*} [allowed] Valor de allowed utilizado por esta operación.
   * @returns {void} Finaliza después de aplicar los efectos de la operación.
   */
  const origin = (source, allowed = ['service-intelligence']) => {
    if (!allowed.includes(source)) throw new ApplicationError(403, 'AGENT_ORIGIN_FORBIDDEN');
  };
  return {
    code,
    codes,
    origin,
  };
}
module.exports = { agentInputPolicy };
