/** @file Autorización canónica de sesiones humanas y acreditaciones vigentes de agentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function identityAuthorizationService({
  authenticateAgent,
  authenticateDelegation,
  ApplicationError,
  authorization,
  messaging,
  origin,
}) {
  /**
   * Ejecuta current dentro del flujo de identity.service.
   * @param {string} source Valor de source utilizado por esta operación.
   * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function current(source) {
    origin(source);
    const context = messaging.getContext();
    if (context.delegation) {
      if (typeof authenticateDelegation !== 'function')
        throw new ApplicationError(401, 'UNAUTHORIZED');
      const principal = await authenticateDelegation(context, source);
      return {
        userCode   : principal.userCode,
        workspace  : principal.workspace,
        workspaces : principal.workspaces,
        policies   : principal.policies,
      };
    }
    if (context.agentAuthorization) {
      if (typeof authenticateAgent !== 'function') throw new ApplicationError(401, 'UNAUTHORIZED');
      const { principal } = await authenticateAgent(context.agentAuthorization, source);
      if (
        principal.userCode !== context.user?.userCode ||
        principal.workspace !== context.workspace
      )
        throw new ApplicationError(401, 'UNAUTHORIZED');
      return {
        userCode   : principal.userCode,
        workspace  : principal.workspace,
        workspaces : principal.workspaces,
        policies   : principal.policies,
      };
    }
    if (!context.user?.userCode || !context.sessionCode)
      throw new ApplicationError(401, 'UNAUTHORIZED');
    const snapshot                           = await authorization.read({
      userCode    : context.user.userCode,
      sessionCode : context.sessionCode,
      now         : Date.now(),
    });
    const { user, session, workspaces = [] } = snapshot || {};
    if (
      !user ||
      user.userType === 'agent' ||
      (user.userType === 'external' &&
        (![
          'service-apigateway',
          'service-communication',
          'service-documents',
          'service-intelligence',
          'service-directory',
          'service-security',
        ].includes(source) ||
          !session?.externalConversationCode ||
          session.externalConversationCode !== context.externalConversationCode ||
          user.externalConversationCode !== context.externalConversationCode)) ||
      !session ||
      session.activeWorkspace !== context.workspace
    )
      throw new ApplicationError(401, 'UNAUTHORIZED');
    const assigned  = [
      ...new Set(
        (user.workspaces || []).filter(
          /**
           * Determina si el elemento cumple el criterio de selección.
           * @param {*} value Valor de value utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (value) =>
            typeof value === 'string' &&
            value &&
            value !== 'allWorkspaces' &&
            session.workspaces?.includes(value),
        ),
      ),
    ];
    const available = workspaces.filter(
      /** @param {string} code Workspace vigente. @returns {boolean} Exige simultáneamente la membresía de cuenta y sesión. */
      (code) => assigned.includes(code),
    );
    if (!available.includes(session.activeWorkspace))
      throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
    return {
      userCode   : user.userCode,
      workspace  : session.activeWorkspace,
      workspaces : available,
      policies   : session.policies || [],
    };
  }
  return { current };
}
module.exports = { identityAuthorizationService };
