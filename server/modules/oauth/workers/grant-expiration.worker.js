/** @file Vence concesiones OAuth mediante Change Streams y fechas concretas, sin sondeos. */
'use strict';
const { createReactiveWorker } = require('../../../library/work/reactive-worker');
const { createMongoChanges }   = require('../../../library/work/mongo-changes');
/** @param {Object} dependencies Persistencia OAuth, conexión propietaria y registro. @returns {Object} Ciclo de vida que no cierra conexiones compartidas. */
function grantExpirationWorker({ store, connection, logger }) {
  const source = createMongoChanges({
    connection,
    collections  : ['SECURITY_OAUTH_GRANT'],
    updateFields : ['active', 'expiresAt'],
    logger,
    component    : 'oauth_grant_expiration',
  });
  const worker = createReactiveWorker({
    source,
    nextAt    : store.nextExpirationAt,
    logger,
    component : 'oauth_grant_expiration',
    /** @param {Object} options Continuidad. @returns {Promise<void>} Reclama el vencimiento sólo mientras el cursor está acreditado. */
    async tick({ shouldStop }) {
      if (!shouldStop()) await store.expireDue(Date.now());
    },
  });
  return {
    /** @returns {Promise<void>} Prepara el índice y recupera vencimientos al abrir el stream. */
    async start() {
      await store.prepareExpiration();
      worker.start();
    },
    close : worker.close,
  };
}
module.exports = { grantExpirationWorker };
