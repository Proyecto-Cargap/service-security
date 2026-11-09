/** @file Parámetros técnicos con metadatos actuales y autorización local por operación. */
'use strict';
const { createAccessMutations }       = require('../../../adapters/persistence/access-mutations');
const { applicationRecord }           = require('../../../adapters/persistence/application-record');
const { ApplicationError }            = require('../../../shared/application-error');
const policy                          = require('../policies/settings.policy');
const { PARAMETERS, validateChanges } = require('../contracts/settings.contract');

/**
 * Compone createSettingsRepository con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} options Colaboradores u opciones: model, messaging.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = function createSettingsRepository({ model, messaging }) {
  const mutations = createAccessMutations({
    model,
    messaging,
    resource  : 'settings',
    codeField : 'parameter',
    eventName : 'security.resource.changed',
  });
  return {
    /**
     * Crea el registro y devuelve el resultado de la operación.
     * @param {*} parameter Valor de parameter utilizado por esta operación.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async create(parameter, data, scope = '') {
      if (typeof parameter !== 'string' || !parameter)
        throw new ApplicationError(400, 'INVALID_PARAMETER');
      const input = policy.authorize(
        'create',
        {
          parameter,
          data,
          workspace    : 'allWorkspaces',
          userCreate   : '',
          userAssigned : '',
        },
        scope,
        messaging.getContext(),
      );
      if (!input) throw new ApplicationError(403, 'FORBIDDEN');
      return applicationRecord(await mutations.create(input));
    },
    /**
     * Obtiene el valor solicitado.
     * @param {*} parameter Valor de parameter utilizado por esta operación.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async get(parameter, scope = '') {
      if (
        scope !== policy.trustedScopes.guest &&
        ((scope !== '' && scope !== 'global') ||
          !messaging.getContext().user?.userCode ||
          !messaging.getContext().policies?.includes('security.settings.view.global'))
      )
        throw new ApplicationError(403, 'FORBIDDEN');
      if (typeof parameter !== 'string' || !parameter)
        throw new ApplicationError(400, 'INVALID_PARAMETER');
      const filter = policy.authorize(
        'view',
        {
          parameter,
          workspace : 'allWorkspaces',
        },
        scope,
        messaging.getContext(),
      );
      if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
      return applicationRecord(await model.findOne(filter));
    },
    /**
     * Resuelve getAll aplicando los filtros y colaboradores del módulo.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async getAll(scope = '') {
      if (
        scope !== policy.trustedScopes.guest &&
        ((scope !== '' && scope !== 'global') ||
          !messaging.getContext().user?.userCode ||
          !messaging.getContext().policies?.includes('security.settings.view.global'))
      )
        throw new ApplicationError(403, 'FORBIDDEN');
      const filter = policy.authorize(
        'view',
        {
          workspace : 'allWorkspaces',
          parameter : { $in: Object.keys(PARAMETERS) },
        },
        scope,
        messaging.getContext(),
      );
      if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
      const items = await model.find(filter).limit(101);
      if (items.length > 100) throw new ApplicationError(409, 'SETTINGS_COLLECTION_TOO_LARGE');
      return applicationRecord(await items);
    },
    /**
     * Actualiza los campos autorizados del registro.
     * @param {*} parameter Valor de parameter utilizado por esta operación.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     * @param {number} [expectedRevision] Revisión leída por el editor; impide sobrescribir cambios concurrentes.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async update(parameter, data, scope = '', expectedRevision) {
      if (
        scope !== policy.trustedScopes.guest &&
        ((scope !== '' && scope !== 'global') ||
          !messaging.getContext().user?.userCode ||
          !messaging.getContext().policies?.includes('security.settings.update.global'))
      )
        throw new ApplicationError(403, 'FORBIDDEN');
      if (typeof parameter !== 'string' || !parameter)
        throw new ApplicationError(400, 'INVALID_PARAMETER');
      validateChanges(parameter, data);
      if (
        expectedRevision !== undefined &&
        (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      )
        throw new ApplicationError(400, 'INVALID_REVISION');
      const filter = policy.authorize(
        'update',
        {
          parameter,
          workspace : 'allWorkspaces',
        },
        scope,
        {
          ...messaging.getContext(),
          changes : { data },
        },
      );
      if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
      const revisionFilter =
        expectedRevision === undefined
          ? filter
          : {
              $and : [
                filter,
                expectedRevision === 0
                  ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
                  : { revision: expectedRevision },
              ],
            };
      const updated        = await mutations.update(
        revisionFilter,
        {
          $set : Object.fromEntries(
            Object.entries(data).map(
              /**
               * Proyecta cada elemento en la estructura requerida por la operación.
               * @param {Array<*>} argument1 Valor de argument1 utilizado por esta operación.
               * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              ([key, value]) => [`data.${key}`, value],
            ),
          ),
        },
        {
          returnDocument : 'after',
          runValidators  : true,
        },
      );
      if (!updated && expectedRevision !== undefined)
        throw new ApplicationError(409, 'SETTINGS_REVISION_CONFLICT');
      return applicationRecord(updated);
    },
  };
};
