/** @file Resuelve roles únicos por lotes con concurrencia y plazo acotados; un fallo nunca equivale a referencias ausentes. */
'use strict';
const { ApplicationError } = require('../../shared/application-error');

/**
 * Ejecuta roleLabels dentro del flujo de role-labels.
 * @param {Object} messaging Puerto de mensajería y contexto autenticado.
 * @param {string[]} codes Códigos públicos que se resuelven en una consulta acotada.
 * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = async function roleLabels(messaging, codes) {
  const labels  = new Map();
  const unique  = [...new Set(codes)];
  const batches = [];
  for (let offset = 0; offset < unique.length; offset += 100)
    batches.push(unique.slice(offset, offset + 100));
  const deadline = Date.now() + 8000;
  let next       = 0;
  let failed     = false;
  /**
   * Ejecuta worker dentro del flujo de role-labels.
   * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
   */
  async function worker() {
    while (!failed && next < batches.length) {
      const batch    = batches[next++];
      const response = await messaging.request(
        'service-directory',
        'role-labels-get-list',
        { codes: batch },
        { deadlineAt: Math.min(deadline, Date.now() + 5000) },
      );
      if (
        response?.statusCode !== 200 ||
        !Array.isArray(response.data?.items) ||
        response.data.items.length > batch.length
      )
        throw new Error('INVALID_ROLE_LABELS_RESPONSE');
      const seen = new Set();
      for (const item of response.data.items) {
        if (
          !batch.includes(item?.roleCode) ||
          seen.has(item.roleCode) ||
          typeof item.name !== 'string'
        )
          throw new Error('INVALID_ROLE_LABELS_RESPONSE');
        seen.add(item.roleCode);
        if (item.name.trim()) labels.set(item.roleCode, item.name.trim());
      }
    }
  }
  try {
    await Promise.all(
      Array.from(
        { length: Math.min(4, batches.length) },

        /**
         * Construye un elemento de la colección resultante.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        () =>
          worker().catch(
            /**
             * Gestiona el fallo de la operación asíncrona y conserva la política de error del módulo.
             * @param {Error} error Fallo recibido por la continuación.
             * @returns {void} Finaliza después de aplicar los efectos de la operación.
             */
            (error) => {
              failed = true;
              throw error;
            },
          ),
      ),
    );
    return labels;
  } catch (cause) {
    throw new ApplicationError(503, 'SESSION_REFERENCES_UNAVAILABLE', { cause });
  }
};
