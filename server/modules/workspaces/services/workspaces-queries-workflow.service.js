/** @file Casos de uso de consulta del recurso workspaces; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de consulta con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function workspacesQueriesWorkflowService({
  ApplicationError,
  logger,
  utilities,
  workspacesRepository,
  workspacesState,
}) {
  return {
    /**
     * Obtiene un registro de espacios de trabajo y prepara los datos utilizados por la respuesta.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {string} [scope] Alcance solicitado para evaluar las restricciones del recurso.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async getOne(condition, scope = '') {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      try {
        workspacesState.document = null;
        workspacesState.document = await workspacesRepository.getOne(condition, scope);
        if (!workspacesState.document) {
          return null;
        }
        return workspacesState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
          cause     : err,
          uncertain : err?.uncertain === true,
        });
      }
    },
    /**
     * Construye los filtros, orden y paginación para consultar espacios de trabajo.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de espacios de trabajo que utiliza fields, sort, order, perPage, page,
     * search, condition, scope.
     * @param {string} [scope] Alcance solicitado para evaluar las restricciones del recurso.
     * @returns {Promise<Object|null>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async getList(data, scope = '') {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const { page, perPage } = utilities.getPublicPagination(data);
      try {
        const paramFields = data.fields || '';
        const paramSort   = data.sort || null;
        const paramOrder  = data.order || null;

        const paramSearch    = data.search || null;
        const paramCondition = data.condition || null;
        scope = scope !== '' ? scope : data.scope === undefined ? '' : data.scope;
        const sort = await utilities.getSortQuery('workspaceCode', paramSort, paramOrder);

        const condition = paramCondition ? paramCondition : {};
        if (!paramCondition) {
          condition.$and = [];
          condition.$and.push({
            workspaceCode : {
              $ne : '',
            },
          });
          if (paramSearch) {
            const words = paramSearch.split('|');
            words.forEach(
              /**
               * Aplica la operación indicada a cada elemento de la colección.
               * @param {*} word Valor de word utilizado por esta operación.
               * @returns {void} Finaliza después de aplicar los efectos de la operación.
               */
              (word) => {
                const regex = new RegExp(utilities.escapeRegex(word), 'i');
                condition.$and.push({
                  $or : [
                    {
                      name : regex,
                    },
                    {
                      description : regex,
                    },
                  ],
                });
              },
            );
          }
        }
        const result = await workspacesRepository.getList(
          condition,
          sort,
          page,
          perPage,
          paramFields,
          scope,
        );
        workspacesState.document = {
          pagination : {
            total   : result.totalCount,
            page    : page + 1,
            perPage : perPage,
          },
          items      : result.listItem,
        };
        return workspacesState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
          cause     : err,
          uncertain : err?.uncertain === true,
        });
      }
    },
  };
}
module.exports = { workspacesQueriesWorkflowService };
