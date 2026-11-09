/** @file Casos de uso de revocación del recurso session; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de revocación con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function sessionRevocationWorkflowService({
  ApplicationError,
  dependencies,
  jwt,
  logger,
  messaging,
  readAll,
  sessionPolicy,
  sessionRepository,
  sessionScopes,
  sessionState,
  tokenContexts,
}) {
  return {
    /**
     * Localiza y elimina el registro de sesiones y coordina las operaciones asociadas presentes en este
     * flujo.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @returns {Promise<Object|null>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async delete(condition, scope = '') {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        sessionState.document = null;
        const ownSession       =
          scope === '' &&
          typeof system.idSession === 'string' &&
          Boolean(system.idSession) &&
          typeof system.sessionCode === 'string' &&
          Boolean(system.sessionCode) &&
          condition.sessionCode === system.sessionCode &&
          typeof system.user?.userCode === 'string' &&
          Boolean(system.user.userCode) &&
          system.user.userType !== 'agent';
        const selectedScope    = ownSession ? sessionScopes.guest : scope;
        const selectedFilter   = ownSession
          ? {
              ...condition,
              userCode : system.user.userCode,
            }
          : condition;
        const authorizedFilter = sessionPolicy.authorize(
          'delete',
          selectedFilter,
          selectedScope,
          system,
        );
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        const context = messaging.getContext();
        const global  =
          selectedScope === sessionScopes.guest ||
          ((scope === '' || scope === 'global') &&
            context.policies?.includes('security.session.delete.global'));
        sessionState.document = await sessionRepository.close(
          global
            ? authorizedFilter
            : {
                $and : [
                  authorizedFilter,
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
              },
          selectedScope,
        );
        if (sessionState.document) {
          effectsCompleted = true;
        }
        return sessionState.document;
      } catch (err) {
        if (err instanceof ApplicationError) {
          if (effectsCompleted) err.uncertain = true;
          throw err;
        }
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
          cause     : err,
          uncertain : effectsCompleted || err?.uncertain === true,
        });
      }
    },
    /**
     * Cierra las sesiones seleccionadas mediante las condiciones de la operación.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @returns {Promise<Object|null>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async deleteAll(condition) {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        sessionState.document = null;
        sessionState.document = await readAll(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {number} page Índice de la página según el contrato de esta operación.
           * @param {number} perPage Cantidad máxima de elementos por página.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (page, perPage) =>
            sessionRepository.getList(
              condition,
              {
                ...{},
                _id : 1,
              },
              page,
              perPage,
              '',
            ),
        );
        for (const item of sessionState.document.listItem) {
          item.active = false;
          item.end = new Date().getTime();
          item.idTransaction = system.idTransaction;
          await sessionRepository.updateItem(item, '', 'delete');
          effectsCompleted = true;
        }
        return sessionState.document;
      } catch (err) {
        if (err instanceof ApplicationError) {
          if (effectsCompleted) err.uncertain = true;
          throw err;
        }
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
          cause     : err,
          uncertain : effectsCompleted || err?.uncertain === true,
        });
      }
    },
    /** Revoca únicamente la sesión identificada por un JWT firmado y vigente.
     * @param {string} token Credencial que se valida sin incorporarla a la salida pública.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async closeToken(token) {
      let claims;
      try {
        if (typeof token !== 'string' || !token || token.length > 16384) throw new Error();
        claims = jwt.verify(token, dependencies.tokenSecret, {
          algorithms : ['HS256'],
          ...tokenContexts.session,
        });
        if (typeof claims?.user?.userCode !== 'string' || !claims.user.userCode) throw new Error();
      } catch {
        throw new ApplicationError(401, 'INVALID_SESSION');
      }
      let effectsCompleted = false;
      try {
        let session = await sessionRepository.getOne(
          {
            token,
            userCode   : claims.user.userCode,
            active     : true,
            expiration : {
              $gt : Date.now() / 1000,
            },
          },
          sessionScopes.guest,
        );
        if (!session || session.userCode !== claims.user.userCode)
          throw new ApplicationError(401, 'INVALID_SESSION');
        session = await sessionRepository.close(
          {
            sessionCode : session.sessionCode,
            token,
            userCode    : claims.user.userCode,
          },
          sessionScopes.guest,
        );
        if (!session) throw new ApplicationError(401, 'INVALID_SESSION');
        effectsCompleted = true;

        return session;
      } catch (cause) {
        if (cause instanceof ApplicationError) {
          if (effectsCompleted) cause.uncertain = true;
          throw cause;
        }
        throw new ApplicationError(503, 'SESSION_CLOSE_FAILED', {
          cause,
          uncertain : effectsCompleted || cause?.uncertain === true,
        });
      }
    },
  };
}
module.exports = { sessionRevocationWorkflowService };
