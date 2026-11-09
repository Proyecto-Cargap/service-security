/** @file Autorización y lectura administrativa de sesiones; conserva entradas, resultados, errores y efectos existentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function sessionAdministrativeAccessService({
  ApplicationError,
  messaging,
  sessionPolicy,
  sessionRepository,
  sessionScopes,
}) {
  /**
   * Ejecuta administrativeFilter dentro del flujo de session.service.
   * @param {Object} condition Valor de condition utilizado por esta operación.
   * @param {string|symbol} scope Alcance solicitado o marcador interno de confianza.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  function administrativeFilter(condition, scope) {
    const context = messaging.getContext();
    if (
      scope === sessionScopes.guest ||
      ((scope === '' || scope === 'global') &&
        context.policies?.includes('security.session.view.global'))
    )
      return condition;
    return {
      $and : [
        condition,
        {
          $or : [
            { workspace: context.workspace },
            {
              workspace       : 'allWorkspaces',
              activeWorkspace : context.workspace,
            },
          ],
        },
      ],
    };
  }
  /**
   * Ejecuta administrativeSession dentro del flujo de session.service.
   * @param {string} code Identificador público del recurso.
   * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function administrativeSession(code, scope = '') {
    if (typeof code !== 'string' || !code || code.length > 100)
      throw new ApplicationError(400, 'INVALID_SESSION_CODE');
    if (typeof scope !== 'string' && typeof scope !== 'symbol')
      throw new ApplicationError(400, 'INVALID_SCOPE');
    const filter = sessionPolicy.authorize(
      'view',
      administrativeFilter({ sessionCode: code }, scope),
      scope,
      messaging.getContext(),
    );
    if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
    return sessionRepository.getOne(filter, sessionScopes.guest);
  }
  return {
    administrativeFilter,
    administrativeSession,
  };
}
module.exports = { sessionAdministrativeAccessService };
