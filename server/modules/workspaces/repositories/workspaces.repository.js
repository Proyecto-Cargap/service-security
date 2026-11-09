/** @file Persistencia de workspaces; CRUD con modelo inyectado y política local aplicada en cada operación. */
'use strict';
const { createAccessMutations } = require('../../../adapters/persistence/access-mutations');
const { applicationRecord }     = require('../../../adapters/persistence/application-record');
const { ApplicationError }      = require('../../../shared/application-error');
const accessPolicy              = require('../policies/workspaces.policy');

/**
 * Compone createWorkspacesRepository con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} options Colaboradores u opciones: model, messaging, userModel, sessionModel, groupModel, policyModel.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = function createWorkspacesRepository({
  model,
  messaging,
  userModel,
  sessionModel,
  groupModel,
  policyModel,
  queuePictures,
}) {
  const mutations = createAccessMutations({
    model,
    messaging,
    queuePictures,
    resource  : 'workspace',
    codeField : 'workspaceCode',
  });
  return {
    /** Lectura interna acotada de referencias; aplica la política vigente en cada petición.
     * @param {string[]} codes Códigos públicos que se resuelven en una consulta acotada.
     * @param {*} [fields] Valor de fields utilizado por esta operación.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async getReferences(codes, fields = '', scope = '') {
      if (
        !Array.isArray(codes) ||
        codes.length > 100 ||
        codes.some(
          /**
           * Comprueba si el elemento satisface la condición.
           * @param {string} code Identificador público del recurso.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (code) => typeof code !== 'string' || !code,
        )
      )
        throw new ApplicationError(400, 'INVALID_REFERENCE_CODES');
      if (!codes.length) return [];
      const filter = accessPolicy.authorize(
        'view',
        {
          workspaceCode : { $in: [...new Set(codes)] },
          erased        : false,
        },
        scope,
        messaging.getContext(),
      );
      if (!filter) return [];
      return applicationRecord(await model.find(filter, fields).limit(100));
    },
    /**
     * Comprueba referencias actuales sin modificar membresías ni registros históricos.
     * Las listas de workspaces de una sesión son instantáneas; sólo bloquea su uso o pertenencia
     * actuales cuando sigue activa y no ha vencido. Los recursos borrados no constituyen referencias.
     * @param {string} workspaceCode Código del workspace cuya baja ya fue autorizada por el caso de uso.
     * @returns {Promise<boolean>} true si existe una referencia vigente, incluso de usuarios o políticas inactivos sin borrar.
     * @throws {Error} Propaga fallos de persistencia; nunca interpreta una consulta fallida como ausencia.
     */
    async hasReferences(workspaceCode) {
      const models = [
        [
          userModel,
          {
            erased : { $ne: true },
            $or    : [{ workspaces: workspaceCode }, { workspace: workspaceCode }],
          },
        ],
        [
          sessionModel,
          {
            erased     : { $ne: true },
            active     : true,
            expiration : { $gt: Date.now() / 1000 },
            $or        : [{ activeWorkspace: workspaceCode }, { workspace: workspaceCode }],
          },
        ],
        [
          groupModel,
          {
            workspace : workspaceCode,
            erased    : { $ne: true },
          },
        ],
        [
          policyModel,
          {
            workspace : workspaceCode,
            erased    : { $ne: true },
          },
        ],
      ];
      for (const [referenceModel, filter] of models)
        if (await referenceModel.exists(filter)) return true;
      return false;
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
     * @param {string} [expectedPictureId] Imagen leída antes de editar; impide sobrescribir un reemplazo concurrente.
     * @returns {Promise<Object>} Documento guardado; ausencia o denegación rechaza con 403.
     */
    async updateItem(document, scope = '', operation = 'update', expectedPictureId) {
      if (!document || typeof document !== 'object' || Array.isArray(document))
        throw new ApplicationError(400, 'INVALID_DOCUMENT');
      if (!document._id || !['update', 'delete'].includes(operation))
        throw new ApplicationError(400, 'INVALID_DOCUMENT');
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');
      const filter = { _id: document._id };
      if (expectedPictureId !== undefined)
        filter['pictureFile.id'] = expectedPictureId || { $exists: false };
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
  };
};
