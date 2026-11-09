/** @file Configuración y emisión de invitaciones de confirmación; conserva entradas, resultados, errores y efectos existentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function userConfirmationTokenService({
  ApplicationError,
  tokenSecret,
  tokenCryptography,
  jwt,
  settingsRepository,
  settingsScopes,
  tokenContexts,
}) {
  /** Verifica configuración y firma antes de crear registros o sustituir una invitación.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const confirmationSettings = async () => {
    const settings   = await settingsRepository.get('user-setings', settingsScopes.guest);
    const expiration = settings?.data?.tokenNotificationExpiration;
    try {
      if (!(
        (typeof expiration === 'string' && expiration.trim()) ||
        (Number.isInteger(expiration) && expiration > 0)
      ))
        throw new Error('INVALID_CONFIRMATION_SETTINGS');
      // Esta firma sólo comprueba el firmante y expiresIn; nunca se conserva ni se publica.
      jwt.sign({}, tokenSecret, {
        algorithm : 'HS256',
        ...tokenContexts.account_confirmation,
        expiresIn : expiration,
      });
      return settings;
    } catch (cause) {
      throw new ApplicationError(503, 'N0001-CONFIRMATION-CONFIG-UNAVAILABLE', {
        cause,
      });
    }
  };
  /**
   * Ejecuta confirmationToken dentro del flujo de user.service.
   * @param {string} userCode Código del usuario relacionado con la operación.
   * @param {*} system Valor de system utilizado por esta operación.
   * @param {*} settings Valor de settings utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const confirmationToken    = (userCode, system, settings) =>
    jwt.sign(
      {
        time          : Date.now(),
        userCode,
        purpose       : 'account_confirmation',
        jti           : tokenCryptography.identifier(),
        idTransaction : system.idTransaction,
      },
      tokenSecret,
      {
        algorithm : 'HS256',
        ...tokenContexts.account_confirmation,
        expiresIn : settings.data.tokenNotificationExpiration,
      },
    );
  return {
    confirmationSettings,
    confirmationToken,
  };
}
module.exports = { userConfirmationTokenService };
