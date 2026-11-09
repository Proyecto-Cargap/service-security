/** @file Casos de uso de eliminación de usuarios; conserva permisos, resultados y efectos del contrato vigente. */
'use strict';
/** Compone exclusivamente las operaciones de eliminación con colaboradores explícitos.
 * @param {Object} dependencies Capacidades requeridas por estas operaciones; no construye adaptadores.
 * @returns {Object} Operaciones de eliminación con el mismo contrato público.
 */
function userRemovalService({ messaging, sessionRepository, userRepository }) {
  return {
    /**
     * Localiza y elimina el registro de usuarios y coordina las operaciones asociadas presentes en este
     * flujo.
     * Envía el comando email-send-transactional al servicio service-connect.
     * Publica el evento security.user.delete para los consumidores registrados.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de usuarios que utiliza code, MQReplic.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async delete(data) {
      return require('./user-deletion.service').userDeletionService({
        messaging,
        users    : userRepository,
        sessions : sessionRepository,
      })(data);
    },
  };
}
module.exports = { userRemovalService };
