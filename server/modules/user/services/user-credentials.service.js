/** @file Casos de uso de credenciales de usuarios; conserva permisos, resultados y efectos del contrato vigente. */
'use strict';
const { userPresenter } = require('../presenters/user.presenter');
/** Compone exclusivamente las operaciones de credenciales con colaboradores explícitos.
 * @param {Object} dependencies Capacidades requeridas por estas operaciones; no construye adaptadores.
 * @returns {Object} Operaciones de credenciales con el mismo contrato público.
 */
function userCredentialsService({
  ApplicationError,
  bcrypt,
  controller,
  id,
  messaging,
  passwordRecovery,
  settingsRepository,
  settingsScopes,
  userRepository,
  userScopes,
  userState,
}) {
  return {
    /**
     * Prepara la recuperación de contraseña mediante un token y el envío de correo de recuperación.
     * Envía el comando email-send-transactional al servicio service-connect.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de usuarios que utiliza user.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async recoverPassword(data) {
      return passwordRecovery.request(data);
    },
    /** Restablece exclusivamente con un token de recuperación vigente.
     * @param {Object} data Datos de entrada de la operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async updatePassword(data) {
      return passwordRecovery.reset(data);
    },
    /**
     * Comprueba el estado de la cuenta y compara la contraseña con el hash almacenado.
     * Devuelve datos de aplicación o propaga ApplicationError.
     *
     * @param {string} password Contraseña recibida para compararla con el hash almacenado.
     * @returns {Promise<null|boolean>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async authentication(password) {
      if (typeof password !== 'string' || !password || password.length > 4096)
        throw new ApplicationError(400, 'INVALID_INPUT');
      const sessionSetings = await settingsRepository.get('session-setings', settingsScopes.guest);
      if (userState.document) {
        if (['agent', 'external'].includes(userState.document.userType))
          throw new ApplicationError(
            403,
            userState.document.userType === 'external'
              ? 'EXTERNAL_INTERACTIVE_LOGIN_FORBIDDEN'
              : 'AGENT_INTERACTIVE_LOGIN_FORBIDDEN',
          );
        if (userState.document.state === 'registered')
          throw new ApplicationError(401, `${id}-${controller}-E0013:User not confirmed`);
        if (!(await bcrypt.compare(password, userState.document.password))) {
          const attempts  = (Number(userState.document.numberAttemptsAccess) || 0) + 1;
          const automatic =
            userState.document.state === 'active' &&
            attempts >= sessionSetings.data.maximumFailedAttempts;
          const changed   = await userRepository.update(
            {
              _id      : userState.document._id,
              password : userState.document.password,
              state    : userState.document.state,
            },
            {
              $set : {
                numberAttemptsAccess : attempts,
                ...(automatic
                  ? {
                      state             : 'blocked',
                      accessBlockReason : 'failed_attempts',
                    }
                  : {}),
              },
            },
            userScopes.guest,
          );
          if (changed && automatic) {
            try {
              const item = userPresenter(changed);
            } catch (cause) {
              throw new ApplicationError(503, 'USER_NOTIFICATION_FAILED', {
                cause,
                uncertain : true,
              });
            }
          }
          throw new ApplicationError(406, `${id}-${controller}-E0003:Password / User incorrect`);
        }
        if (userState.document.validity < new Date().getTime()) {
          throw new ApplicationError(401, `${id}-${controller}-E0014:Expired user`);
        }
        if (userState.document.state == 'blocked') {
          throw new ApplicationError(401, `${id}-${controller}-E0010:User blocked`);
        }
        if (userState.document.state == 'inactive') {
          throw new ApplicationError(401, `${id}-${controller}-E0011:User inactive`);
        }
        if (userState.document.state == 'authorized') {
          throw new ApplicationError(401, `${id}-${controller}-E0012:User not authorized`);
        }
        if (userState.document.state == 'registered') {
          throw new ApplicationError(401, `${id}-${controller}-E0013:User not confirmed`);
        }
        const authenticated = await userRepository.update(
          {
            _id      : userState.document._id,
            password : userState.document.password,
            state    : 'active',
            erased   : false,
            validity : { $gt: Date.now() },
          },
          {
            $set : {
              lastAccessDate       : Date.now(),
              numberAttemptsAccess : 0,
            },
          },
          userScopes.guest,
        );
        if (!authenticated) throw new ApplicationError(406, 'CREDENTIALS_CHANGED');
        userState.document = authenticated;
        return true;
      }
      throw new ApplicationError(500, `${id}-${controller}-E0000:Error system aqui`);
    },
  };
}
module.exports = { userCredentialsService };
