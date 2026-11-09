/** @file Casos de uso de consulta del recurso policy; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de consulta con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function policyQueriesWorkflowService({
  ApplicationError,
  logger,
  policyRepository,
  policyState,
  utilities,
}) {
  return {
    /**
     * Obtiene un registro de políticas de acceso y prepara los datos utilizados por la respuesta.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {string} scope Alcance solicitado para evaluar las restricciones del recurso.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async getOne(condition, scope) {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      try {
        policyState.document = null;
        policyState.document = await policyRepository.getOne(condition, scope);
        if (!policyState.document) {
          return null;
        }
        return policyState.document;
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
     * Construye los filtros, orden y paginación para consultar políticas de acceso.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de políticas de acceso que utiliza fields, sort, order, perPage, page,
     * search, dateRange, active, base.
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
        const paramDateRange = data.dateRange || null;
        const paramActive    = data.active || null;
        const paramBase      = data.base || null;

        const paramIndex     = data.index || null;
        const paramCondition = data.condition || null;
        scope = scope !== '' ? scope : data.scope === undefined ? '' : data.scope;
        const sort = {
          ...utilities.getSortQuery('service', paramSort, paramOrder),
          policyCode : 1,
        };

        const condition = paramCondition ? paramCondition : {};
        if (!paramCondition) {
          condition.$and = [];
          condition.$and.push({
            identifier : {
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
                      service : regex,
                    },
                    {
                      identifier : regex,
                    },
                    {
                      section : regex,
                    },
                    {
                      description : regex,
                    },
                  ],
                });
              },
            );
          }
          if (paramDateRange) {
            const date = paramDateRange.split('|');
            if (date[0] != '') {
              condition.$and.push({
                creationDate : {
                  $gte : date[0],
                },
              });
            }
            if (date[1] != '') {
              condition.$and.push({
                creationDate : {
                  $lte : date[1],
                },
              });
            }
          }
          if (paramActive) {
            const states   = paramActive.split('|');
            const active   = states.includes('active');
            const inActive = states.includes('inactive');
            if (active && !inActive) {
              condition.$and.push({
                active : 'true',
              });
            } else if (!active && inActive) {
              condition.$and.push({
                active : 'false',
              });
            } else if (!active && !inActive) {
              condition.$and.push({
                active : null,
              });
            }
          } else {
            condition.$and.push({
              active : 'true',
            });
          }
          if (paramBase) {
            const states = paramBase.split('|');
            const base   = states.includes('base');
            const nobase = states.includes('nobase');
            if (base && !nobase) {
              condition.$and.push({
                base : 'true',
              });
            } else if (!base && nobase) {
              condition.$and.push({
                base : 'false',
              });
            } else if (!base && !nobase) {
              condition.$and.push({
                base : null,
              });
            }
          } else {
          }

          if (paramIndex) {
            condition.$and.push({
              service : paramIndex,
            });
          }
        }
        const result = await policyRepository.getList(
          condition,
          sort,
          page,
          perPage,
          paramFields,
          scope,
        );
        policyState.document = {
          pagination : {
            total   : result.totalCount,
            page    : page + 1,
            perPage : perPage,
          },
          items      : result.listItem,
        };
        return policyState.document;
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
     * Consulta los valores distintos del campo solicitado.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {string} field Nombre del campo utilizado por la operación.
     * @returns {Promise<Object|null>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async getDistinct(field) {
      if (typeof field !== 'string' || !field || field.length > 4096)
        throw new ApplicationError(400, 'INVALID_INPUT');
      try {
        const condition = {};
        condition.$and = [];
        condition.$and.push({
          identifier : {
            $ne : '',
          },
        });

        const result = await policyRepository.getDistinct(field, condition);
        policyState.document = {
          items : result,
        };
        return policyState.document;
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
module.exports = { policyQueriesWorkflowService };
