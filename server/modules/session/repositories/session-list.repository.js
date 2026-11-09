/** @file Consulta administrativa con identidades mínimas, filtro autorizado antes de las referencias y paginación final. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
const policy               = require('../policies/session.policy');
const { FIELDS }           = require('../dtos/session.dto');

/**
 * Ejecuta nullableText dentro del flujo de session-list.repository.
 * @param {*} expression Valor de expression utilizado por esta operación.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function nullableText(expression) {
  return {
    $let : {
      vars : {
        text : {
          $cond : [{ $eq: [{ $type: expression }, 'string'] }, { $trim: { input: expression } }, ''],
        },
      },
      in   : { $cond: [{ $eq: ['$$text', ''] }, null, '$$text'] },
    },
  };
}

/**
 * Compone sessionListRepository con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} options Colaboradores u opciones: model, messaging.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = function sessionListRepository({ model, messaging }) {
  /**
   * Comprueba permisos y delimita el alcance de la operación.
   * @param {Object} filter Filtros de selección que se autorizan antes de consultar.
   * @param {string|symbol} scope Alcance solicitado o marcador interno de confianza.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const authorize = (filter, scope) =>
    policy.authorize('view', filter, scope, messaging.getContext());
  return {
    /** @param {Object} filter Filtros base. @param {string|symbol} scope Alcance verificado. @returns {Promise<string[]>} Sólo roles de sesiones visibles. */
    async getAdministrativeRoleCodes(filter, scope) {
      const authorized = authorize(filter, scope);
      if (!authorized) return [];
      const rows = await model.aggregate([
        { $match: authorized },
        {
          $match : {
            roleCode : {
              $type : 'string',
              $ne   : '',
            },
          },
        },
        { $group: { _id: '$roleCode' } },
      ]);
      return rows.map(
        /**
         * Proyecta cada elemento en la estructura requerida por la operación.
         * @param {*} row Valor de row utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (row) => row._id,
      );
    },
    /** @param {Object} filter Filtros base. @param {Object} query Texto, orden y paginación. @param {Map<string,string>} labels Nombres acreditados por Directory. @param {string|symbol} scope Alcance. @returns {Promise<Object>} Página y conteo del resultado completo. */
    async getAdministrativeList(filter, query, labels, scope) {
      const authorized = authorize(filter, scope);
      if (!authorized)
        return {
          listItem   : [],
          totalCount : 0,
        };
      const sortKey = Object.keys(query.sort)[0];
      if (!FIELDS.includes(sortKey) && !['user', 'roleName'].includes(sortKey))
        throw new ApplicationError(400, 'INVALID_SORT');
      const branches = [...labels].map(
        /**
         * Proyecta cada elemento en la estructura requerida por la operación.
         * @param {Array<*>} argument1 Valor de argument1 utilizado por esta operación.
         * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        ([code, name]) => ({
          case : { $eq: ['$roleCode', { $literal: code }] },
          then : { $literal: name },
        }),
      );
      const pipeline = [
        { $match: authorized },
        {
          $lookup : {
            from         : 'SECURITY_USER',
            localField   : 'userCode',
            foreignField : 'userCode',
            pipeline     : [
              { $match: { erased: false } },
              {
                $project : {
                  _id  : 0,
                  user : 1,
                },
              },
            ],
            as           : 'sessionUser',
          },
        },
        {
          $set : {
            user     : nullableText({ $arrayElemAt: ['$sessionUser.user', 0] }),
            roleName : branches.length
              ? {
                  $switch : {
                    branches,
                    default : null,
                  },
                }
              : { $literal: null },
          },
        },
      ];
      if (query.search)
        pipeline.push({
          $match : {
            $or : ['sessionCode', 'userCode', 'roleCode', 'activeWorkspace', 'user', 'roleName'].map(
              /**
               * Proyecta cada elemento en la estructura requerida por la operación.
               * @param {string} key Clave del campo o recurso que se procesa.
               * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (key) => ({
                [key] : {
                  $regex   : query.search,
                  $options : 'i',
                },
              }),
            ),
          },
        });
      if (query.user)
        pipeline.push({
          $match : {
            user : {
              $regex   : query.user,
              $options : 'i',
            },
          },
        });
      const numericSort = Object.fromEntries(
        Object.entries(query.sort).map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {Array<*>} argument1 Valor de argument1 utilizado por esta operación.
           * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          ([key, direction]) => {
            if (!FIELDS.includes(key) && !['user', 'roleName'].includes(key))
              throw new ApplicationError(400, 'INVALID_SORT');
            if (![1, -1, 'asc', 'desc'].includes(direction))
              throw new ApplicationError(400, 'INVALID_SORT');
            return [key, direction === -1 || direction === 'desc' ? -1 : 1];
          },
        ),
      );
      const sort        = {
        ...numericSort,
        sessionCode : numericSort.sessionCode ?? 1,
      };
      if (['user', 'roleName'].includes(sortKey)) {
        pipeline.push({
          $set : { missingIdentity: { $cond: [{ $eq: [`$${sortKey}`, null] }, 1, 0] } },
        });
      }
      const items = [
        {
          $sort : ['user', 'roleName'].includes(sortKey)
            ? {
                missingIdentity : 1,
                ...sort,
              }
            : sort,
        },
      ];
      if (query.perPage)
        items.push({ $skip: query.page * query.perPage }, { $limit: query.perPage });
      items.push({
        $project : {
          _id : 0,
          ...Object.fromEntries(
            [...FIELDS, 'user', 'roleName'].map(
              /**
               * Proyecta cada elemento en la estructura requerida por la operación.
               * @param {string} key Clave del campo o recurso que se procesa.
               * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (key) => [key, 1],
            ),
          ),
        },
      });
      pipeline.push({
        $facet : {
          items,
          total : [{ $count: 'count' }],
        },
      });
      const [result] = await model.aggregate(pipeline).collation({
        locale   : 'es',
        strength : 2,
      });
      return {
        listItem   : result?.items ?? [],
        totalCount : result?.total[0]?.count ?? 0,
      };
    },
  };
};
