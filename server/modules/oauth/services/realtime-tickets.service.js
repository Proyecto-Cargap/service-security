/** @file Tickets documentales de un uso; separan el consentimiento OAuth del transporte Socket.IO. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');

/** @param {Object} dependencies Persistencia, principal vigente, contexto, reloj y entropía inyectados. @returns {Object} Emisión y consumo acotados por origen y espacio. */
function realtimeTickets({ store, resolve, context, now, randomToken }) {
  /** @param {Object} principal Principal acreditado por Security. @returns {void} Exige lectura documental en un espacio concreto. */
  function authorize(principal) {
    if (!principal.workspace || !principal.scopes.includes('documents:read'))
      throw new ApplicationError(403, 'DOCUMENT_REALTIME_FORBIDDEN');
  }
  return {
    /** @param {Object} data Entrada vacía; la autoridad procede del contexto. @param {string} source Origen RPC. @returns {Promise<Object>} Ticket opaco válido durante sesenta segundos. */
    async create(data, source) {
      if (source !== 'service-apigateway')
        throw new ApplicationError(403, 'OAUTH_ORIGIN_FORBIDDEN');
      const actor = context();
      if (!actor.delegation || !actor.workspace)
        throw new ApplicationError(401, 'OAUTH_CONNECTION_REQUIRED');
      const principal = await resolve(
        {
          ...actor.delegation,
          workspace : actor.workspace,
        },
        source,
      );
      authorize(principal);
      if (principal.userCode !== actor.user?.userCode)
        throw new ApplicationError(401, 'OAUTH_CONNECTION_REVOKED');
      const ticket    = randomToken();
      const expiresAt = Math.min(now() + 60000, principal.expiresAt);
      await store.put(
        {
          model   : 'DocumentsRealtimeTicket',
          id      : ticket,
          grantId : principal.grantCode,
          ttl     : Math.max(1, Math.floor((expiresAt - now()) / 1000)),
          payload : {
            userCode  : principal.userCode,
            grantCode : principal.grantCode,
            clientId  : principal.clientId,
            workspace : principal.workspace,
            expiresAt,
            channel   : 'realtime',
          },
        },
        now(),
      );
      return {
        ticket,
        expiresAt,
      };
    },
    /** @param {Object} data Ticket opaco. @param {string} source Sólo Platform puede consumirlo. @returns {Promise<Object>} Principal interno con concesión y vencimiento de conexión, nunca token OAuth. */
    async consume(data, source) {
      if (source !== 'service-platform') throw new ApplicationError(403, 'OAUTH_ORIGIN_FORBIDDEN');
      const selector = {
        model : 'DocumentsRealtimeTicket',
        id    : data.ticket,
      };
      const record   = await store.get(selector, now());
      if (
        !record ||
        record.consumed ||
        record.payload.expiresAt <= now() ||
        record.payload.channel !== 'realtime' ||
        !(await store.consume(selector, now()))
      )
        throw new ApplicationError(401, 'REALTIME_TICKET_INVALID');
      const principal = await resolve(record.payload, source);
      authorize(principal);
      if (principal.userCode !== record.payload.userCode)
        throw new ApplicationError(401, 'OAUTH_CONNECTION_REVOKED');
      return {
        ...principal,
        expiresAt : Math.min(principal.expiresAt, now() + 600000),
        channel   : 'realtime',
      };
    },
  };
}
module.exports = { realtimeTickets };
