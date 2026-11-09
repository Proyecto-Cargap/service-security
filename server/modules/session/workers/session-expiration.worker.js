/** @file Despierta por Change Streams y por la expiración concreta más próxima; no consulta periódicamente sesiones. */
'use strict';
const { createReactiveWorker } = require('../../../library/work/reactive-worker');
/** @param {Object} dependencies Persistencia cercada, fuente de cambios y registro seguro. @returns {Object} Ciclo de vida sin conexiones compartidas propias. */
function sessionExpirationWorker({ repository, source, logger }) {
  const worker = createReactiveWorker({
    source,
    nextAt    : repository.nextAt,
    logger,
    component : 'session_expiration',
    /** @param {Object} options Continuidad. @returns {Promise<void>} Una transición por vencimiento; perder continuidad impide nuevas escrituras. */
    async tick({ shouldStop }) {
      if (!shouldStop()) await repository.publishDue();
    },
  });
  return {
    /** @returns {Promise<void>} Recupera vencimientos históricos después de confirmar el cursor. */
    async start() {
      await repository.prepare();
      worker.start();
    },
    close : worker.close,
  };
}
/** @param {Object} dependencies Modelo opcional, mensajería y registro del arranque. @returns {Object} Composición productiva todavía detenida. */
function sessionExpirationLifecycle(dependencies) {
  const model      = dependencies.models?.session || require('../models/session.model');
  const repository =
    require('../repositories/session-expiration.repository').sessionExpirationRepository({
      model,
      messaging : dependencies.messaging,
    });
  return sessionExpirationWorker({
    repository,
    logger : dependencies.logger,
    source : require('../../../library/work/mongo-changes').createMongoChanges({
      connection   : model.db,
      collections  : [model.collection.name],
      updateFields : ['active', 'erased', 'expiration', 'expirationNoticeFor'],
      logger       : dependencies.logger,
      component    : 'session_expiration',
    }),
  });
}
module.exports = {
  sessionExpirationWorker,
  sessionExpirationLifecycle,
};
