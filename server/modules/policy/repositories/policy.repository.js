/** @file Persistencia de policy; CRUD con modelo inyectado y política local aplicada en cada operación. */
'use strict';
const { accessRead }            = require('../../../adapters/persistence/access-read');
const { createAccessMutations } = require('../../../adapters/persistence/access-mutations');
const { applicationRecord }     = require('../../../adapters/persistence/application-record');
const { ApplicationError }      = require('../../../shared/application-error');
const accessPolicy              = require('../policies/policy.policy');

/**
 * Compone createPolicyRepository con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} options Colaboradores u opciones: model, messaging, groupModel.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = function createPolicyRepository({ model, messaging, groupModel }) {
  const mutations = createAccessMutations({
    model,
    messaging,
    resource  : 'policy',
    codeField : 'policyCode',
  });
  return {
    readAccess : accessRead({
      model,
      policy    : accessPolicy,
      messaging,
      codeField : 'policyCode',
      fields    : 'identifier -_id',
    }),
    /**
     * Evalúa la condición expresada por hasReferences.
     * @param {*} policyCode Valor de policyCode utilizado por esta operación.
     * @returns {Promise<boolean>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async hasReferences(policyCode) {
      return !!(await groupModel.exists({ policies: policyCode }));
    },
    /**
     * @param {Object} input Datos de creación; los metadatos verificados los aplica la política.
     * @param {string|symbol} [scope] Alcance público o marcador de la política de esta capacidad.
     * @returns {Promise<Object>} Documento guardado; la denegación rechaza con 403.
     */
    async create(input, scope = '') {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new ApplicationError(400, 'INVALID_INPUT');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedInput = accessPolicy.authorize(
        'create',
        input,
        scope,
        messaging.getContext(),
      );
      if (!authorizedInput) throw new ApplicationError(403, 'FORBIDDEN');
      const document = await mutations.create(authorizedInput);
      return applicationRecord(await document);
    },
    /**
     * @param {Object} filter Filtro explícito, incluido {} para todos los documentos autorizados.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @returns {Promise<Object|null>} Documento encontrado; ausencia o lectura denegada devuelve null.
     */
    async getOne(filter, scope = '') {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedFilter = accessPolicy.authorize(
        'view',
        filter,
        scope,
        messaging.getContext(),
      );
      if (!authorizedFilter) return null;
      return applicationRecord(await model.findOne(authorizedFilter));
    },
    /** Página desde cero; perPage=0 conserva la consulta explícita sin límite.
     * @param {Object} filter Filtro explícito de selección.
     * @param {Object} [sort] Orden de los resultados.
     * @param {number} [page] Índice de página desde cero.
     * @param {number} [perPage] Tamaño de página entre cero y 10000.
     * @param {string|Object} [fields] Proyección de campos.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @returns {Promise<{listItem:Array,totalCount:number}>} Página autorizada o vacía.
     */
    async getList(filter, sort = {}, page = 0, perPage = 20, fields = '', scope = '') {
      if (
        !Number.isInteger(page) ||
        page < 0 ||
        !Number.isInteger(perPage) ||
        perPage < 0 ||
        perPage > 10000
      )
        throw new ApplicationError(400, 'INVALID_PAGINATION');
      if (
        typeof fields !== 'string' &&
        (!fields || typeof fields !== 'object' || Array.isArray(fields))
      )
        throw new ApplicationError(400, 'INVALID_FIELDS');
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');
      if (!sort || typeof sort !== 'object' || Array.isArray(sort))
        throw new ApplicationError(400, 'INVALID_SORT');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedFilter = accessPolicy.authorize(
        'view',
        filter,
        scope,
        messaging.getContext(),
      );
      if (!authorizedFilter)
        return {
          listItem   : [],
          totalCount : 0,
        };
      const pageQuery  = model
        .find(authorizedFilter, fields)
        .skip(perPage * page)
        .limit(perPage)
        .sort(sort);
      const countQuery = model.countDocuments(authorizedFilter);
      const listItem   = await pageQuery;
      const totalCount = await countQuery;
      return {
        listItem : applicationRecord(listItem),
        totalCount,
      };
    },
    /**
     * @param {Object} filter Filtro explícito de selección.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @returns {Promise<number>} Número de coincidencias; lectura denegada devuelve cero.
     */
    async count(filter, scope = '') {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedFilter = accessPolicy.authorize(
        'view',
        filter,
        scope,
        messaging.getContext(),
      );
      if (!authorizedFilter) return 0;
      return applicationRecord(await model.countDocuments(authorizedFilter));
    },
    /**
     * @param {Object} filter Filtro explícito de selección.
     * @param {Object} changes Cambios u operadores MongoDB permitidos.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @returns {Promise<Object|null>} Documento actualizado y validado, o null cuando no coincide.
     */
    async update(filter, changes, scope = '') {
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');
      if (!changes || typeof changes !== 'object' || Array.isArray(changes))
        throw new ApplicationError(400, 'INVALID_CHANGES');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedFilter = accessPolicy.authorize('update', filter, scope, {
        ...messaging.getContext(),
        changes,
      });
      if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
      return applicationRecord(
        await mutations.update(authorizedFilter, changes, {
          returnDocument : 'after',
          runValidators  : true,
        }),
      );
    },
    /** Actualiza por _id con autorización atómica; operation=delete conserva las bajas lógicas.
     * @param {Object} document Documento con _id y cambios pendientes.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @param {'update'|'delete'} [operation] Permiso necesario para el efecto de negocio.
     * @returns {Promise<Object>} Documento guardado; ausencia o denegación rechaza con 403.
     */
    async updateItem(document, scope = '', operation = 'update') {
      if (!document || typeof document !== 'object' || Array.isArray(document))
        throw new ApplicationError(400, 'INVALID_DOCUMENT');
      if (!document._id || !['update', 'delete'].includes(operation))
        throw new ApplicationError(400, 'INVALID_DOCUMENT');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');
      const filter  = { _id: document._id };
      const changes =
        typeof document.toObject === 'function' ? document.toObject() : { ...document };
      if (
        Object.keys(changes).some(
          /**
           * Comprueba si el elemento satisface la condición.
           * @param {string} field Campo utilizado por la operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (field) => field.startsWith('$'),
        )
      )
        throw new ApplicationError(400, 'INVALID_DOCUMENT');
      delete changes._id;
      delete changes.__v;
      const authorizedFilter = accessPolicy.authorize(operation, filter, scope, {
        ...messaging.getContext(),
        changes,
      });
      if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
      delete changes.userCreate;
      changes.updateDate = Date.now();
      document.updateDate = changes.updateDate;
      const saved = await mutations.update(
        authorizedFilter,
        { $set: changes },
        {
          returnDocument : 'after',
          runValidators  : true,
        },
      );
      if (!saved) throw new ApplicationError(403, 'FORBIDDEN');
      return applicationRecord(await saved);
    },
    /**
     * @param {Object} filter Filtro explícito de selección.
     * @param {boolean} [isLogical=true] true marca la baja; false elimina físicamente.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @returns {Promise<Object|null>} Documento tras la baja lógica o documento eliminado físicamente; null si no coincide.
     */
    async deleteOne(filter, isLogical = true, scope = '') {
      if (typeof isLogical !== 'boolean') throw new ApplicationError(400, 'INVALID_DELETE_MODE');
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedFilter = accessPolicy.authorize(
        'delete',
        filter,
        scope,
        messaging.getContext(),
      );
      if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
      if (isLogical) {
        const now = Date.now();
        return applicationRecord(
          await mutations.update(
            { $and: [authorizedFilter, { erased: { $ne: true } }] },
            {
              $set : {
                erased     : true,
                updateDate : now,
              },
            },
            {
              returnDocument : 'after',
              runValidators  : true,
            },
          ),
        );
      }
      return applicationRecord(await mutations.remove(authorizedFilter));
    },
    /**
     * @param {Object} filter Filtro explícito de selección.
     * @param {boolean} [isLogical=true] true marca la baja; false elimina físicamente.
     * @param {string|symbol} [scope] Alcance solicitado.
     * @returns {Promise<import('mongodb').DeleteResult>} deletedCount cuenta nuevas bajas lógicas o eliminaciones físicas.
     */
    async deleteMany(filter, isLogical = true, scope = '') {
      if (typeof isLogical !== 'boolean') throw new ApplicationError(400, 'INVALID_DELETE_MODE');
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');

      const authorizedFilter = accessPolicy.authorize(
        'delete',
        filter,
        scope,
        messaging.getContext(),
      );
      if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
      if (isLogical) {
        const now    = Date.now();
        const result = await mutations.many(
          { $and: [authorizedFilter, { erased: { $ne: true } }] },
          {
            $set : {
              erased     : true,
              updateDate : now,
            },
          },
          { runValidators: true },
        );
        return {
          acknowledged : result.acknowledged,
          deletedCount : result.modifiedCount,
        };
      }
      return applicationRecord(await mutations.many(authorizedFilter, null));
    },
    /** Lista únicamente categorías de políticas visibles para la identidad verificada.
     * @returns {Promise<Array>} Valores distintos del único campo público permitido.
     * @param {string} field Campo utilizado por la operación.
     * @param {Object} [filter] Filtros de selección que se autorizan antes de consultar.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     */
    async getDistinct(field, filter = {}, scope = '') {
      if (field !== 'service') throw new ApplicationError(400, 'INVALID_FIELD');
      if (!filter || typeof filter !== 'object' || Array.isArray(filter))
        throw new ApplicationError(400, 'INVALID_FILTER');

      const authorizedFilter = accessPolicy.authorize(
        'view',
        filter,
        scope,
        messaging.getContext(),
      );
      if (!authorizedFilter) return [];
      return applicationRecord(await model.distinct(field, authorizedFilter));
    },
  };
};
