/** @file Lectura agrupada del contrato canónico de perfiles de contactos; conserva entradas, resultados, errores y efectos existentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function identityContactProfilesService({ ApplicationError, messaging }) {
  /**
   * Ejecuta contactProfiles dentro del flujo de identity.service.
   * @param {Object[]} rows Filas obtenidas de persistencia o de una consulta.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function contactProfiles(rows) {
    const result = new Map();
    const unique = [
      ...new Set(
        rows.map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => row.contactCode || row.userCode,
        ),
      ),
    ];
    for (let start = 0; start < unique.length; start += 100) {
      const response = await messaging.request('service-directory', 'contact-profile-get-list', {
        codes : unique.slice(start, start + 100),
      });
      if (response?.statusCode !== 200 || !Array.isArray(response.data?.items))
        throw new ApplicationError(503, 'IDENTITY_DIRECTORY_UNAVAILABLE');
      for (const profile of response.data.items) result.set(profile.contactCode, profile);
    }
    return result;
  }
  return { contactProfiles };
}
module.exports = { identityContactProfilesService };
