/** @file Escrituras de Security y referencias de acceso confirmadas en la misma transacción. */
'use strict';

/** @param {Object} dependencies Modelo, mensajería durable y recurso registrado. @returns {Object} Escrituras sin alterar la autorización del repositorio. */
function createAccessMutations({
  model,
  messaging,
  resource,
  codeField,
  queuePictures,
  eventName = 'security.access.changed',
}) {
  /** @param {Object} item Registro confirmado o retirado. @param {Object} session Transacción del productor. @param {boolean} [removed] Baja física con revisión de lápida. @returns {Promise<void>} Publica sólo identidad y revisión, nunca permisos ni credenciales. */
  async function changed(item, session, removed = false) {
    if (!item) return;
    if (resource === 'workspace') {
      const files = [...(item.pictureCleanup || [])];
      if ((removed || item.erased) && item.pictureFile?.id) files.push(item.pictureFile.id);
      const pending = files.filter(
        /** @param {string} fileId Archivo candidato. @returns {boolean} Preserva la imagen todavía vinculada. */
        (fileId) => removed || item.erased || fileId !== item.pictureFile?.id,
      );
      if (pending.length) {
        if (typeof queuePictures !== 'function')
          throw new TypeError('WORKSPACE_PICTURE_QUEUE_REQUIRED');
        await queuePictures(item.workspaceCode, pending, session);
      }
    }
    await messaging.publishEvent(
      eventName,
      {
        resource,
        code     : item[codeField],
        revision : (item.revision || 0) + (removed ? 1 : 0),
        ...(resource === 'session' ? { userCode: item.userCode } : {}),
      },
      { session },
    );
  }
  /** @param {Object} session Sesión opcional del caso de uso. @param {Function} work Escritura y publicación. @returns {Promise<Object>} Participa en la transacción existente o crea una propia. */
  function transaction(session, work) {
    return session ? work(session) : model.db.transaction(work);
  }
  const mutations = {
    /** @param {Object} input Datos ya autorizados. @param {Object} session Transacción opcional. @returns {Promise<Object>} Registro persistido con evento durable. */
    create(input, session) {
      return transaction(
        session,
        /** @param {Object} active Transacción. @returns {Promise<Object>} Alta atómica. */
        async (active) => {
          const document = new model({
            ...input,
            revision : 1,
          });
          await document.save({ session: active });
          await changed(document, active);
          return document;
        },
      );
    },
    /** @param {Object} filter Filtro autorizado y fencing. @param {Object} changes Campos u operadores. @param {Object} options Opciones del repositorio, incluida sesión. @returns {Promise<Object|null>} Estado actualizado y referencia atómica. */
    update(filter, changes, options = {}) {
      return transaction(
        options.session,
        /** @param {Object} session Transacción. @returns {Promise<Object|null>} Modificación con revisión del productor. */
        async (session) => {
          const update = Object.keys(changes).some(
            /** @param {string} field Clave de actualización. @returns {boolean} Identifica operadores MongoDB. */
            (field) => field.startsWith('$'),
          )
            ? Object.fromEntries(
                Object.entries(changes).map(
                  /** @param {Array} entry Operador y campos. @returns {Array} Copia independiente sin modificar la entrada del repositorio. */
                  ([operator, values]) => [operator, { ...values }],
                ),
              )
            : { $set: { ...changes } };
          for (const values of Object.values(update)) delete values.revision;
          update.$inc = {
            ...update.$inc,
            revision : 1,
          };
          const item = await model.findOneAndUpdate(filter, update, {
            ...options,
            session,
            returnDocument : 'after',
            runValidators  : true,
          });
          await changed(item, session);
          return item;
        },
      );
    },
    /** @param {Object} filter Selección autorizada. @param {Object} options Sesión opcional. @returns {Promise<Object|null>} Baja física y referencia del registro retirado. */
    remove(filter, options = {}) {
      return transaction(
        options.session,
        /** @param {Object} session Transacción. @returns {Promise<Object|null>} Retirada confirmada junto al evento. */
        async (session) => {
          const item = await model.findOneAndDelete(filter, { session });
          await changed(item, session, true);
          return item;
        },
      );
    },
    /** @param {Object} filter Selección autorizada. @param {Object|null} changes Cambios o null para baja física. @param {Object} options Sesión opcional. @returns {Promise<Object>} Efectos y referencias de cada fila, sin cargar la colección completa. */
    many(filter, changes, options = {}) {
      return transaction(
        options.session,
        /** @param {Object} session Transacción. @returns {Promise<Object>} Cuenta escrituras confirmadas. */
        async (session) => {
          let count    = 0;
          const cursor = model.find(filter).select('_id').session(session).lean().cursor();
          try {
            for await (const row of cursor) {
              const selected = { $and: [filter, { _id: row._id }] };
              const item     = changes
                ? await mutations.update(selected, changes, {
                    ...options,
                    session,
                  })
                : await mutations.remove(selected, { session });
              if (item) count++;
            }
          } finally {
            await cursor.close();
          }
          return {
            acknowledged  : true,
            modifiedCount : count,
            deletedCount  : count,
          };
        },
      );
    },
  };
  return mutations;
}
module.exports = { createAccessMutations };
