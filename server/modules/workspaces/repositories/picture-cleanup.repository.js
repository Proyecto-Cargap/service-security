/** @file Cola de limpieza con reclamación atómica, vencimiento durable y confirmación por propietario. */
'use strict';
/** @param {Object} dependencies Modelos de cola/espacios de trabajo, transacción, reloj e identidad técnica. @returns {Object} Persistencia acotada de trabajo pendiente. */
function pictureCleanupRepository({
  model,
  workspaces,
  transaction,
  clock,
  newId,
  leaseMs = 360000,
}) {
  return {
    /** @returns {Promise<void>} Prepara la colección técnica antes de aceptar escrituras de negocio. */
    async prepare() {
      await model.createCollection();
      await model.createIndexes();
    },
    /** @param {string} workspaceCode Propietario acreditado. @param {string[]} fileIds Imágenes ya desvinculadas. @param {Object} [session] Transacción de negocio existente. @returns {Promise<void>} Comparte la transacción activa de la escritura del espacio de trabajo. */
    async enqueue(workspaceCode, fileIds, session) {
      for (const fileId of new Set(fileIds)) {
        await model.updateOne(
          { _id: `${workspaceCode}:${fileId}` },
          {
            $setOnInsert : {
              workspaceCode,
              fileId,
              nextAt   : 0,
              attempts : 0,
            },
          },
          {
            upsert : true,
            session,
          },
        );
      }
    },
    /** @returns {Promise<number|undefined>} Sólo el próximo vencimiento confirmado; no hay barridos cuando la cola está vacía. */
    async nextAt() {
      const row = await model
        .findOne({}, { nextAt: 1 })
        .sort({
          nextAt : 1,
          _id    : 1,
        })
        .lean();
      return row?.nextAt;
    },
    /** @returns {Promise<Object|null>} Una instancia reclama un único archivo con plazo superior al RPC externo. */
    claim() {
      return model
        .findOneAndUpdate(
          { nextAt: { $lte: clock() } },
          {
            $set : {
              token  : newId(),
              nextAt : clock() + leaseMs,
            },
            $inc : { attempts: 1 },
          },
          {
            sort           : {
              nextAt : 1,
              _id    : 1,
            },
            returnDocument : 'after',
          },
        )
        .lean();
    },
    /** @param {Object} job Reclamación. @returns {Promise<boolean>} Nunca elimina un archivo que siga siendo la fotografía actual. */
    async linked(job) {
      return !!(await workspaces.exists({
        workspaceCode    : job.workspaceCode,
        erased           : { $ne: true },
        'pictureFile.id' : job.fileId,
      }));
    },
    /** @param {Object} job Reclamación vigente. @returns {Promise<boolean>} Confirma archivo y marcador juntos; un propietario vencido no modifica el trabajo nuevo. */
    finish(job) {
      return transaction(
        /** @param {Object} session Transacción de confirmación. @returns {Promise<boolean>} El borrado y el marcador pertenecen a la misma confirmación del propietario. */
        async function confirmCleanup(session) {
          const removed = await model.deleteOne(
            {
              _id    : job._id,
              token  : job.token,
              nextAt : { $gt: clock() },
            },
            { session },
          );
          if (!removed.deletedCount) return false;
          await workspaces.updateOne(
            { workspaceCode: job.workspaceCode },
            { $pull: { pictureCleanup: job.fileId } },
            { session },
          );
          return true;
        },
      );
    },
    /** @param {Object} job Reclamación fallida. @returns {Promise<Object>} Reintento concreto persistido, nunca temporizador de sondeo. */
    retry(job) {
      return model.updateOne(
        {
          _id    : job._id,
          token  : job.token,
          nextAt : { $gt: clock() },
        },
        {
          $set   : { nextAt: clock() + Math.min(60000, 1000 * 2 ** Math.min(job.attempts - 1, 6)) },
          $unset : { token: '' },
        },
      );
    },
    /** @returns {Object} Cursor de recuperación inicial; las lecturas públicas nunca buscan trabajo pendiente. */
    legacy() {
      return workspaces
        .find(
          { 'pictureCleanup.0': { $exists: true } },
          {
            workspaceCode  : 1,
            pictureCleanup : 1,
            pictureFile    : 1,
            erased         : 1,
          },
        )
        .lean()
        .cursor({ batchSize: 64 });
    },
  };
}
module.exports = { pictureCleanupRepository };
