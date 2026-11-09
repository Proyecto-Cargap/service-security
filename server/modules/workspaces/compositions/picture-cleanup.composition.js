/** @file Compone la cola durable y el ciclo de vida de limpieza de fotografías de workspaces. */
'use strict';
/** @param {Object} dependencies Modelos opcionales y capacidades de arranque. @returns {Object} Persistencia compartida por las escrituras y fábrica del trabajador. */
function pictureCleanupComposition(dependencies) {
  const model      = dependencies.models?.pictureCleanup || require('../models/picture-cleanup.model');
  const workspaces = dependencies.models?.workspaces || require('../models/workspaces.model');
  const repository = require('../repositories/picture-cleanup.repository').pictureCleanupRepository(
    {
      model,
      workspaces,
      /** @param {Function} work Confirmación cercada por token. @returns {Promise<Object>} Confirma cola y marcador histórico atómicamente. */
      transaction : (work) => model.db.transaction(work),
      clock       : Date.now,
      newId       : require('node:crypto').randomUUID,
    },
  );
  return {
    repository,
    /** @param {Object} options Almacenamiento autorizado y observación. @returns {Object} Trabajador aún detenido; sólo el arranque abre Change Streams. */
    lifecycle({ pictures, logger }) {
      return require('../workers/picture-cleanup.worker').pictureCleanupWorker({
        repository,
        pictures,
        logger,
        source : require('../../../library/work/mongo-changes').createMongoChanges({
          connection  : model.db,
          collections : [model.collection.name],
          logger,
          component   : 'workspace_picture_cleanup',
        }),
      });
    },
  };
}
module.exports = { pictureCleanupComposition };
