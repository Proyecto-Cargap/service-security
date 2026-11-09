/** @file Casos de uso de administración del recurso session; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de administración con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function sessionAdministrationWorkflowService({
  ApplicationError,
  controller,
  dependencies,
  id,
  logger,
  messaging,
  sessionPolicy,
  sessionRepository,
  sessionScopes,
  sessionState,
  workspacesScopes,
  workspacesService,
}) {
  return {
    /**
     * Localiza el registro de sesiones, aplica los cambios admitidos por esta operación y los persiste.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {Object} data Datos de sesiones que utiliza workspaceCode.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async update(condition, data) {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        sessionState.document = null;
        const requestedScope = data.scope === undefined ? '' : data.scope;
        const changes        = {};
        if (data.workspaceCode !== undefined && data.workspaceCode !== '') {
          if (typeof data.workspaceCode !== 'string')
            throw new ApplicationError(400, 'INVALID_INPUT');
          changes.activeWorkspace = data.workspaceCode;
        }
        const context          = {
          ...messaging.getContext(),
          changes,
        };
        const authorizedFilter = sessionPolicy.authorize(
          'update',
          condition,
          requestedScope,
          context,
        );
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        sessionState.document = await sessionRepository.getOne(
          authorizedFilter,
          sessionScopes.guest,
        );
        if (!sessionState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0005:Session does not exist`);
        }
        if (data.workspaceCode !== undefined && data.workspaceCode !== '') {
          if (
            typeof data.workspaceCode !== 'string' ||
            !sessionState.document.workspaces?.includes(data.workspaceCode)
          )
            throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
          const selectedWorkspace = await workspacesService(dependencies).getOne(
            {
              workspaceCode : data.workspaceCode,
              erased        : false,
            },
            workspacesScopes.guest,
          );
          if (!selectedWorkspace) throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
          changes.activeWorkspace = data.workspaceCode;
          changes.lastAccess = Date.now();
        }
        if (!sessionState.document.active) throw new ApplicationError(403, 'FORBIDDEN');
        const filter = {
          _id      : sessionState.document._id,
          userCode : sessionState.document.userCode,
          active   : true,
        };
        if (Object.hasOwn(changes, 'activeWorkspace')) filter.workspaces = changes.activeWorkspace;
        if (!sessionPolicy.authorize('update', filter, requestedScope, context))
          throw new ApplicationError(403, 'FORBIDDEN');
        const updated = await sessionRepository.update(filter, changes, requestedScope);
        if (!updated) throw new ApplicationError(403, 'FORBIDDEN');
        sessionState.document = updated;
        effectsCompleted = true;

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
  };
}
module.exports = { sessionAdministrationWorkflowService };
