/** @file Baja y revocación atómicas; sólo registra efectos durables dentro de la transacción. */
'use strict';
const { userPresenter }    = require('../presenters/user.presenter');
const { ApplicationError } = require('../../../shared/application-error');
const policy               = require('../policies/user.policy');
const { name, id }         = require('../../../../package.json');

/**
 * Compone la baja atómica del usuario, la revocación completa de sesiones y la publicación durable de efectos posteriores.
 * @param {Object} options Colaboradores u opciones: messaging, users, sessions.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function userDeletionService({ messaging, users, sessions }) {
  /**
   * Retira el recurso indicado.
   * @param {Object} data Datos de entrada de la operación.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  return async function remove(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new ApplicationError(400, 'INVALID_INPUT');
    if (typeof data.code !== 'string' || !data.code)
      throw new ApplicationError(400, `${id}-C001-E0001:code is required`);
    const scope   = data.scope === undefined ? '' : data.scope;
    const context = messaging.getContext();
    const filter  = policy.authorize('delete', { userCode: data.code }, scope, context);
    if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
    return messaging
      .transaction(
        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @param {Object} session Sesión que agrupa las operaciones de persistencia.
         * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        async (session) => {
          let user = await users.getOne(filter, policy.trustedScopes.guest, session);
          if (!user) throw new ApplicationError(406, `${id}-C001-E0005:User does not exist`);
          if (!user.erased) user = await users.markDeleted(filter, scope, session);
          const key = `user-delete:${user.userCode}:${user.deletionDate || user.updateDate}`;
          await sessions.revokeForUser(user.userCode, session);

          await messaging.sendCommand(
            name,
            'user-deletion-email',
            {
              userCode     : user.userCode,
              deletionDate : user.deletionDate || user.updateDate,
            },
            {
              session,
              publicationId : `${key}:email-intent`,
            },
          );
          if (data.MQReplic === undefined || data.MQReplic)
            await messaging.publishEvent('security.user.delete', userPresenter(user), {
              session,
              publicationId : `${key}:event`,
            });
          return user;
        },
      )
      .catch(
        /**
         * Gestiona el fallo de la operación asíncrona y conserva la política de error del módulo.
         * @param {Error} cause Causa del fallo que se procesa.
         * @returns {void} Finaliza después de aplicar los efectos de la operación.
         */
        (cause) => {
          if (cause instanceof ApplicationError) throw cause;
          if (cause?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
          const uncertain =
            cause?.uncertain === true ||
            cause?.hasErrorLabel?.('UnknownTransactionCommitResult') === true;
          throw new ApplicationError(503, 'USER_DELETION_UNAVAILABLE', {
            cause,
            uncertain,
          });
        },
      );
  };
}
module.exports = { userDeletionService };
