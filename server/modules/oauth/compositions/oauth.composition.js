/** @file Conecta OAuth con persistencia propia y lectores canónicos de identidad. */
'use strict';
/** @param {Object} dependencies Repositorios, mensajería y sustituciones de pruebas. @returns {Object} Servicio y catálogo de OAuth. */
function oauthComposition(dependencies) {
  const { messaging, repositories } = dependencies;
  const identities                  = require('../../identity/services/identity.service').identityService({
    messaging,
    authorization : repositories.identityAuthorization,
    users         : repositories.user,
    sessions      : repositories.session,
    workspaces    : repositories.workspaces,
    groups        : repositories.group,
    policies      : repositories.policy,
  });
  const database                    = require('../../../adapters/mongodb/connection').connection;
  const crypto                      = require('node:crypto');
  const store                       =
    dependencies.oauthStore ||
    require('../repositories/oauth.repository').oauthRepository({
      /** @returns {Object} Base abierta por el ciclo de vida existente. */
      db           : () => database.db,
      transaction  : database.transaction.bind(database),
      /** @returns {Object|undefined} La consulta nativa comparte la instantánea que emite el cursor del productor. */
      readSession  : () => database.base.transactionAsyncLocalStorage?.getStore()?.session,
      publishEvent : messaging.publishEvent.bind(messaging),
      /** @param {string} value Identificador privado. @returns {string} Huella irreversible. */
      digest       : (value) => crypto.createHash('sha256').update(value).digest('hex'),
    });
  const service                     = require('../services/oauth.service').oauthService({
    store,
    identities,
    now     : Date.now,
    /** @param {string[]} codes Espacios ya intersectados con consentimiento y membresías vigentes. @returns {Promise<Object[]>} Referencias públicas actuales, en lotes acotados. */
    async workspaceReferences(codes) {
      const references = [];
      for (let offset = 0; offset < codes.length; offset += 100)
        references.push(
          ...(await repositories.workspaces.getReferences(
            codes.slice(offset, offset + 100),
            'workspaceCode name',
            require('../../workspaces/policies/workspaces.policy').trustedScopes.guest,
          )),
        );
      return references;
    },
    /** @returns {Object} Contexto aislado de la solicitud. */
    context : () => messaging.getContext(),
    /** @param {string} userCode Cuenta solicitada por el proveedor. @returns {Promise<Object|null>} Cuenta interactiva activa, sin datos secretos. */
    async account(userCode) {
      const user = await repositories.user.getOne(
        {
          userCode,
          erased   : false,
          state    : 'active',
          validity : { $gt: Date.now() },
        },
        require('../../user/policies/user.policy').trustedScopes.guest,
      );
      return !user || ['agent', 'external'].includes(user.userType)
        ? null
        : { credentialsChangedAt: Number(user.credentialsChangedAt) || 0 };
    },
  });
  const tickets                     = require('../services/realtime-tickets.service').realtimeTickets({
    store,
    resolve                                                                                      : service.resolve,
    now                                                                                          : Date.now,
    /** @returns {Object} Contexto acreditado del transporte. */ context                         : () =>
      messaging.getContext(),
    /** @returns {string} Ticket de 256 bits, almacenado sólo mediante su huella. */ randomToken :
      () => crypto.randomBytes(32).toString('base64url'),
  });
  service.realtimeTicketCreate = tickets.create;
  service.realtimeTicketConsume = tickets.consume;
  const operations = {
    'oauth-realtime-ticket-create'  : 'realtimeTicketCreate',
    'oauth-realtime-ticket-consume' : 'realtimeTicketConsume',
    'oauth-execution-record'        : 'recordExecution',
    'oauth-client-authorize'        : 'clientAuthorize',
    'oauth-storage-get'             : 'storageGet',
    'oauth-storage-put'             : 'storagePut',
    'oauth-storage-consume'         : 'storageConsume',
    'oauth-storage-destroy'         : 'storageDestroy',
    'oauth-family-revoke'           : 'familyRevoke',
    'oauth-account-get'             : 'accountGet',
    'oauth-grant-create'            : 'grantCreate',
    'oauth-grant-get-list'          : 'grantList',
    'oauth-grant-revoke'            : 'grantRevoke',
    'oauth-principal-resolve'       : 'resolve',
  };
  return {
    service,
    lifecycle : require('../workers/grant-expiration.worker').grantExpirationWorker({
      store,
      connection : database,
      logger     : dependencies.logger,
    }),
    entries   : Object.entries(operations).map(
      /** @param {Array} entry Nombre y método de aplicación. @returns {Object} Handler RPC con sobre validado. */
      ([name, method]) => ({
        name,
        kind : 'action',
        /** @param {Object} message Entrada validada por el DTO. @returns {Promise<Object>} Resultado público o privado según el contrato interno. */
        async handler(message) {
          return messaging.successResponse(
            200,
            await service[method](message.data, message.originService),
          );
        },
      }),
    ),
  };
}
module.exports = { oauthComposition };
