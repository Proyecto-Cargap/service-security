/** @file Casos de uso de autorización del recurso session; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de autorización con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function sessionAuthorizationWorkflowService({
  ApplicationError,
  dependencies,
  jwt,
  logger,
  sessionRepository,
  tokenContexts,
}) {
  return {
    /**
     * Ejecuta authenticate dentro del flujo de session.service.
     * @param {Object} data Datos de entrada de la operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async authenticate(data) {
      /**
       * Ejecuta denied dentro del flujo de session.service.
       * @returns {void} Finaliza después de aplicar los efectos de la operación.
       */
      const denied = () => {
        throw new ApplicationError(401, 'INVALID_SESSION');
      };
      if (typeof data?.token !== 'string' || !data.token || data.token.length > 16384)
        return denied();
      let claims;
      try {
        claims = jwt.verify(data.token, dependencies.tokenSecret, {
          algorithms : ['HS256'],
          ...tokenContexts.session,
        });
      } catch {
        return denied();
      }
      const userCode = claims?.user?.userCode;
      if (typeof userCode !== 'string' || !userCode) return denied();
      try {
        const access = await dependencies.repositories.authentication.read({
          token           : data.token,
          userCode,
          now             : Date.now(),
          currentPolicies : data.currentPolicies === true,
        });
        if (!access?.session) return denied();
        const { session, user, workspace } = access;
        if (
          !user ||
          ['agent', 'external'].includes(user.userType) ||
          user.state !== 'active' ||
          user.erased ||
          user.userCode !== userCode ||
          Number(user.validity) <= Date.now() ||
          (Number(claims.credentialsChangedAt) || 0) !== (Number(user.credentialsChangedAt) || 0)
        )
          return denied();
        const activeWorkspace = session.activeWorkspace;
        if (
          typeof activeWorkspace !== 'string' ||
          !activeWorkspace ||
          activeWorkspace === 'allWorkspaces' ||
          !Array.isArray(session.workspaces) ||
          !session.workspaces.includes(activeWorkspace) ||
          !Array.isArray(user.workspaces) ||
          !user.workspaces.includes(activeWorkspace)
        )
          return denied();
        /**
         * Ejecuta strings dentro del flujo de session.service.
         * @param {*} value Valor de value utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        const strings = (value) =>
          Array.isArray(value)
            ? [
                ...new Set(
                  value.filter(
                    /**
                     * Determina si el elemento cumple el criterio de selección.
                     * @param {*} item Valor de item utilizado por esta operación.
                     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                     */
                    (item) => typeof item === 'string' && item,
                  ),
                ),
              ]
            : [];
        if (!workspace) return denied();
        const policies  = strings(
          data.currentPolicies === true ? access.policies : session.policies,
        );
        const refreshMs = Math.max(1, Number(dependencies.sessionLastAccessRefreshMs) || 300000);
        const now       = Date.now();
        if (
          data.refreshAccess === true &&
          (!session.lastAccess || Number(session.lastAccess) <= now - refreshMs)
        ) {
          await sessionRepository.refreshAccess(session._id, now, refreshMs).catch(
            /**
             * Gestiona el fallo de la operación asíncrona y conserva la política de error del módulo.
             * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
             */
            () =>
              logger.error({
                component : 'session',
                event     : 'access_refresh_failed',
              }),
          );
        }
        return {
          userCode,
          sessionId   : String(session._id),
          sessionCode : session.sessionCode,
          user        : {
            userCode,
            contactCode : user.contactCode,
            userType    : user.userType,
            roleCode    : user.roleCode,
          },
          groups      : strings(user.groups),
          policies,
          ...(data.currentPolicies === true ? { currentPoliciesVerified: true } : {}),
          activeWorkspace,
          workspaces  : strings(user.workspaces),
          expiration  : session.expiration,
        };
      } catch (error) {
        if (error instanceof ApplicationError && error.statusCode === 401) throw error;
        if (error?.statusCode === 404) return denied();
        logger.error({
          component : 'service',
          event     : 'operation_failed',
          code      : 'AUTHENTICATION_UNAVAILABLE',
        });
        throw new ApplicationError(503, 'AUTHENTICATION_UNAVAILABLE', {
          cause     : error,
          uncertain : error?.uncertain === true,
        });
      }
    },
  };
}
module.exports = { sessionAuthorizationWorkflowService };
