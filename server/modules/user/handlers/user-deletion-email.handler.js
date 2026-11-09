/** @file Prepara el correo después del commit; su aceptación durable es deduplicable. */
'use strict';
const { MessagingError } = require('../../../library/messaging/errors');
const userActionDtos     = require('../dtos/user.actions.dto');
const { trustedScopes }  = require('../policies/user.policy');
/**
 * Ejecuta userDeletionEmail dentro del flujo de user-deletion-email.
 * @param {Object} options Colaboradores u opciones: messaging, users, information.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function userDeletionEmail({ messaging, users, information }) {
  /**
   * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
   * @param {Object} data Datos de entrada de la operación.
   * @param {Object} execution Metadatos de la ejecución en curso.
   * @returns {Promise<undefined>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  return async (data, execution) => {
    if (execution?.message?.source !== 'service-security' || execution?.kind !== 'command')
      throw new MessagingError('FORBIDDEN');
    data = userActionDtos['user-deletion-email'].input(data);
    if (typeof data?.userCode !== 'string' || !Number.isFinite(data.deletionDate))
      throw new MessagingError('INVALID_INPUT');
    const user = await users.getOne(
      {
        userCode : data.userCode,
        erased   : true,
        $or      : [
          { deletionDate: data.deletionDate },
          {
            deletionDate : { $exists: false },
            updateDate   : data.deletionDate,
          },
        ],
      },
      trustedScopes.guest,
    );
    if (!user) return;
    let configuration;
    try {
      configuration = await information.get(messaging);
    } catch (cause) {
      // Una lectura de branding fallida no ha enviado correo ni ejecutado efectos externos.
      throw new MessagingError('DELETION_INFORMATION_UNAVAILABLE', undefined, {
        retryable : true,
        cause,
      });
    }
    await messaging.transaction(
      /**
       * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
       * @param {Object} session Sesión que agrupa las operaciones de persistencia.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (session) =>
        messaging.sendCommand(
          'service-connect',
          'email-send-transactional',
          {
            template      : 'security-user-delete',
            workspaceCode : user.workspace,
            email         : user.user,
            data          : JSON.stringify({
              company : configuration.title,
            }),
          },
          {
            session,
            publicationId : `user-delete:${data.userCode}:${data.deletionDate}:email`,
          },
        ),
    );
  };
}
module.exports = { userDeletionEmail };
