/** @file Lectura autorizada de imágenes de usuarios; preserva datos, permisos y errores públicos. */
'use strict';
/** Compone operaciones con sus colaboradores mínimos.
 * @param {Object} dependencies Lectores y capacidades abstractas requeridos.
 * @returns {Object} Casos de uso sin construir implementaciones técnicas.
 */
function identityPictureService({
  ApplicationError,
  codes,
  current,
  messaging,
  userScopes,
  users,
}) {
  return {
    /**
     * Ejecuta picture dentro del flujo de identity.service.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string} source Valor de source utilizado por esta operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async picture(data, source) {
      await current(source);
      codes([data.userCode]);
      const size = data.size || '100';
      if (!['original', '050', '100', '200', '300', '500', '1000'].includes(size))
        throw new ApplicationError(400, 'INVALID_IMAGE_SIZE');
      const user = await users.getOne(
        {
          userCode : data.userCode,
          erased   : false,
        },
        userScopes.guest,
      );
      if (!user) throw new ApplicationError(404, 'USER_PICTURE_NOT_FOUND');
      const response = await messaging.request(
        'service-directory',
        'contact-picture-read',
        {
          contactCode : user.contactCode || user.userCode,
          size,
        },
        { timeoutMs: 310000 },
      );
      if (response?.statusCode !== 200)
        throw new ApplicationError(
          response?.statusCode || 503,
          response?.descriptionCode || 'IDENTITY_DIRECTORY_UNAVAILABLE',
        );
      return response.data;
    },
  };
}
module.exports = { identityPictureService };
