/** @file Casos de uso de perfiles del recurso session; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de perfiles con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function sessionProfilesWorkflowService({
  ApplicationError,
  administrativeSession,
  detailService,
  ownProfile,
}) {
  return {
    /** @param {Object} data Código de sesión y variante. @returns {Promise<Object>} Imagen del contacto de una sesión autorizada. */
    async getProfilePicture(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const size = data.size ?? '100';
      if (!['original', '050', '100', '200', '300', '500', '1000'].includes(size))
        throw new ApplicationError(400, 'INVALID_IMAGE_SIZE');
      const record = await administrativeSession(data.code);
      if (!record) throw new ApplicationError(404, 'SESSION_NOT_FOUND');
      return detailService().picture(record, size);
    },
    /** @returns {Promise<Object>} Proyección mínima del perfil propio acreditado por el contexto. */
    async getOwnProfile() {
      return ownProfile().get();
    },
    /** @param {Object} data Variante de imagen, sin identidad elegible. @returns {Promise<Object>} Foto privada del actor autenticado. */
    async getOwnProfilePicture(data) {
      return ownProfile().picture(data);
    },
  };
}
module.exports = { sessionProfilesWorkflowService };
