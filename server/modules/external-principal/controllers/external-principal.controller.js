/** @file Adaptación RPC cerrada de alta y sesiones internas de personas externas. */
'use strict';
/** Compone handlers sin construir persistencia.
 * @param {Object} dependencies Servicio de identidad y mensajería.
 * @returns {Object} Operaciones autorizadas por el origen del sobre.
 */
function externalPrincipalController({ service, messaging }) {
  return {
    /** @param {Object} message Contacto y vínculo interno. @returns {Promise<Object>} Identidad canónica sin credenciales. */
    async provision(message) {
      return messaging.successResponse(
        200,
        await service.provision(message.data, message.originService),
      );
    },
    /** @param {Object} message Vínculo interno. @returns {Promise<Object>} Contexto breve, nunca apto para login HTTP. */
    async resolve(message) {
      return messaging.successResponse(
        200,
        await service.resolve(message.data, message.originService),
      );
    },
  };
}
module.exports = { externalPrincipalController };
