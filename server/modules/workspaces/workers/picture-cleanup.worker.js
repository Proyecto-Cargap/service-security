/** @file Procesa una fotografía por reclamación y despierta únicamente por cambios o vencimientos concretos. */
'use strict';
const { createReactiveWorker } = require('../../../library/work/reactive-worker');
/** @param {Object} dependencies Persistencia técnica, Files, Change Streams y registro seguro. @returns {Object} Ciclo de vida cerrado al perder continuidad. */
function pictureCleanupWorker({ repository, pictures, source, logger }) {
  const worker = createReactiveWorker({
    source,
    nextAt    : repository.nextAt,
    logger,
    component : 'workspace_picture_cleanup',
    /** @param {Object} options Continuidad y cierre. @returns {Promise<void>} Efecto idempotente fuera de la transacción de negocio. */
    async tick({ shouldStop }) {
      if (shouldStop()) return;
      const job = await repository.claim();
      if (!job) return;
      try {
        if (shouldStop()) {
          await repository.retry(job);
          return;
        }
        if (
          (await repository.linked(job)) ||
          (await pictures.remove(job.fileId, job.workspaceCode))
        ) {
          await repository.finish(job);
        } else {
          await repository.retry(job);
        }
      } catch {
        await repository.retry(job);
        logger.error({
          component : 'workspace_picture_cleanup',
          event     : 'cleanup_pending',
        });
      }
    },
  });
  return {
    /** @returns {Promise<void>} Recupera marcadores históricos una vez por arranque; después sólo procesa la cola técnica. */
    async start() {
      await repository.prepare();
      worker.start();
      const cursor = repository.legacy();
      try {
        for await (const workspace of cursor) {
          await repository.enqueue(
            workspace.workspaceCode,
            workspace.pictureCleanup.filter(
              /** @param {string} fileId Referencia histórica. @returns {boolean} Sólo archivos desvinculados. */
              (fileId) => workspace.erased || fileId !== workspace.pictureFile?.id,
            ),
          );
        }
      } finally {
        await cursor.close();
      }
    },
    close : worker.close,
  };
}
module.exports = { pictureCleanupWorker };
