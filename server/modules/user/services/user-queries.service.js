/** @file Casos de uso de consulta de usuarios; conserva permisos, resultados y efectos del contrato vigente. */
'use strict';
const { userPresenter } = require('../presenters/user.presenter');
/** Compone exclusivamente las operaciones de consulta con colaboradores explícitos.
 * @param {Object} dependencies Capacidades requeridas por estas operaciones; no construye adaptadores.
 * @returns {Object} Operaciones de consulta con el mismo contrato público.
 */
function userQueriesService({
  ApplicationError,
  controller,
  dependencies,
  groupScopes,
  groupService,
  id,
  logger,
  messaging,
  policyScopes,
  policyService,
  userPolicy,
  userRepository,
  userScopes,
  userState,
  utilities,
}) {
  return {
    /**
     * Obtiene un registro de usuarios y prepara los datos utilizados por la respuesta.
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
        userState.document = await userRepository.getOne(condition, scope);
        if (!userState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0005:User does not exist`);
        }
        return userState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(
          err.statusCode || 500,
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : err?.uncertain === true,
          },
        );
      }
    },
    /**
     * Construye los filtros, orden y paginación para consultar usuarios.
     * Consulta mediante RPC la acción contact-get-list del servicio service-directory.
     * Consulta mediante RPC la acción role-get-one del servicio service-directory.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de usuarios que utiliza fields, sort, order, perPage, page, search,
     * dateRange, state, roleCode, userCodeList.
     * @returns {Promise<Object|null>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async getList(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const { page, perPage } = utilities.getPublicPagination(data);
      try {
        const system      = messaging.getContext();
        const paramFields = data.fields || '';
        const paramSort   = data.sort || null;
        const paramOrder  = data.order || null;

        const paramSearch    = data.search || null;
        const paramDateRange = data.dateRange || null;
        const paramState     = data.state || null;
        const paramRoleCode  = data.roleCode || null;
        const sort           = await utilities.getSortQuery('userCode', paramSort, paramOrder);

        const requestedScope = data.scope === undefined ? '' : data.scope;
        if (!userPolicy.authorize('view', {}, requestedScope, system)) {
          userState.document = {
            pagination : {
              total : 0,
              page  : page + 1,
              perPage,
            },
            items      : [],
          };
          return userState.document;
        }
        const condition = {};
        condition.$and = [];
        condition.$and.push({
          erased : false,
        });
        /**
         * Normaliza valores de filtro separados por barras verticales para construir la consulta de usuarios.
         *
         * @param {*} value Valor que se normaliza antes de utilizarlo en la operación.
         * @returns {string[]} Valores normalizados obtenidos del filtro recibido.
         */
        const splitPipeValues = (value) =>
          value
            ? value
                .split('|')
                .map(
                  /**
                   * Proyecta cada elemento en la estructura requerida por la operación.
                   * @param {*} item Valor de item utilizado por esta operación.
                   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                   */
                  (item) => item.trim(),
                )
                .filter(
                  /**
                   * Determina si el elemento cumple el criterio de selección.
                   * @param {*} item Valor de item utilizado por esta operación.
                   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                   */
                  (item) => item != '',
                )
            : [];

        if (paramState) {
          const states = splitPipeValues(paramState);
          if (states.length > 0) {
            condition.$and.push({
              state : {
                $in : states,
              },
            });
          }
        }
        if (paramRoleCode) {
          const roles = splitPipeValues(paramRoleCode);
          if (roles.length > 0) {
            condition.$and.push({
              roleCode : {
                $in : roles,
              },
            });
          }
        }
        if (data.userCodeList != undefined) {
          const userCodeList = `${data.userCodeList}`
            .split(',')
            .map(
              /**
               * Proyecta cada elemento en la estructura requerida por la operación.
               * @param {*} item Valor de item utilizado por esta operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (item) => item.trim(),
            )
            .filter(
              /**
               * Determina si el elemento cumple el criterio de selección.
               * @param {*} item Valor de item utilizado por esta operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (item) => item != '',
            );
          if (userCodeList.length > 0) {
            condition.$and.push({
              userCode : {
                $in : userCodeList,
              },
            });
          }
        }
        if (paramSearch) {
          const words         = splitPipeValues(paramSearch);
          let contactCodeList = [];
          if (words.length > 0) {
            try {
              const contacts = await utilities.collectPages(
                /**
                 * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
                 * @param {*} pagination Valor de pagination utilizado por esta operación.
                 * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                 */
                async (pagination) => {
                  const response = await messaging.request(
                    'service-directory',
                    'contact-get-list',
                    {
                      search : words.join('|'),
                      fields : 'contactCode',
                      sort   : 'contactCode',
                      ...pagination,
                    },
                  );
                  if (response.statusCode !== 200)
                    throw new ApplicationError(response.statusCode || 502, 'CONTACT_SEARCH_FAILED');
                  return response.data;
                },
              );
              contactCodeList = contacts.items
                .map(
                  /**
                   * Proyecta cada elemento en la estructura requerida por la operación.
                   * @param {*} item Valor de item utilizado por esta operación.
                   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                   */
                  (item) => item.contactCode,
                )
                .filter(Boolean);
            } catch (error) {
              if (error instanceof ApplicationError) throw error;
              contactCodeList = [];
            }
          }
          words.forEach(
            /**
             * Aplica la operación indicada a cada elemento de la colección.
             * @param {*} word Valor de word utilizado por esta operación.
             * @returns {void} Finaliza después de aplicar los efectos de la operación.
             */
            (word) => {
              const regex           = new RegExp(utilities.escapeRegex(word), 'i');
              const searchCondition = {
                $or : [
                  {
                    user : regex,
                  },
                  {
                    code : word,
                  },
                ],
              };
              if (contactCodeList.length > 0) {
                searchCondition.$or.push({
                  contactCode : {
                    $in : contactCodeList,
                  },
                });
                searchCondition.$or.push({
                  userCode : {
                    $in : contactCodeList,
                  },
                });
              }
              condition.$and.push({
                $or : searchCondition.$or,
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
        const result    = await userRepository.getList(
          condition,
          sort,
          page,
          perPage,
          paramFields,
          requestedScope,
        );
        const roleCache = new Map();
        const listItem  = await Promise.all(
          result.listItem.map(
            /**
             * Proyecta cada elemento en la estructura requerida por la operación.
             * @param {*} item Valor de item utilizado por esta operación.
             * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
             */
            async (item) => {
              const role = await utilities.cachedEntity(
                roleCache,
                item.roleCode || '',
                /**
                 * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
                 * @param {string} code Identificador público del recurso.
                 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                 */
                (code) =>
                  messaging.request('service-directory', 'role-get-one', {
                    code,
                  }),
              );
              return {
                ...userPresenter(item),
                role : role ? role.data : null,
              };
            },
          ),
        );
        userState.document = {
          pagination : {
            total   : result.totalCount,
            page    : page + 1,
            perPage : perPage,
          },
          items      : listItem,
        };
        return userState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(
          err.statusCode || 500,
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : err?.uncertain === true,
          },
        );
      }
    },
    /**
     * Busca usuarios vinculados a los grupos que contienen la política solicitada.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de usuarios que utiliza identifier.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async getByPolicy(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      try {
        if (data.identifier == undefined || data.identifier == '') {
          throw new ApplicationError(400, `${id}-${controller}-E0001:identifier is required`);
        }
        const { page, perPage } = utilities.getPublicPagination(data);
        const authorizedFilter  = userPolicy.authorize('view', {}, '', messaging.getContext());
        if (!authorizedFilter)
          return {
            pagination : {
              total : 0,
              page  : page + 1,
              perPage,
            },
            items      : [],
          };
        const policyServiceInstance = policyService(dependencies);
        const policyValue           = await policyServiceInstance.getOne(
          {
            identifier : data.identifier,
          },
          policyScopes.guest,
        );
        if (!policyValue)
          return {
            pagination : {
              total : 0,
              page  : page + 1,
              perPage,
            },
            items      : [],
          };
        const groupServiceInstance = groupService(dependencies);
        const groupValue           = await utilities.collectPages(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {*} pagination Valor de pagination utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (pagination) =>
            groupServiceInstance.getList(
              {
                ...{
                  condition : {
                    policies : {
                      $in : [policyValue.policyCode],
                    },
                  },
                  fields    : 'groupCode',
                },
                ...pagination,
              },
              groupScopes.guest,
            ),
        );
        const groupCode            = [];
        groupValue.items.forEach(
          /**
           * Aplica la operación indicada a cada elemento de la colección.
           * @param {*} item Valor de item utilizado por esta operación.
           * @returns {void} Finaliza después de aplicar los efectos de la operación.
           */
          (item) => {
            groupCode.push(item.groupCode);
          },
        );
        const sort   = utilities.getSortQuery('userCode');
        const result = await userRepository.getList(
          { $and: [authorizedFilter, { groups: { $in: groupCode } }] },
          sort,
          page,
          perPage,
          '',
          userScopes.guest,
        );
        userState.document = {
          pagination : {
            total : result.totalCount,
            page  : page + 1,
            perPage,
          },
          items      : result.listItem,
        };
        return userState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(
          err.statusCode || 500,
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : err?.uncertain === true,
          },
        );
      }
    },
  };
}
module.exports = { userQueriesService };
