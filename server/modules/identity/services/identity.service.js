/** @file Identidad, perfiles y membresía canónicos; ninguna consulta cambia según su consumidor. */
'use strict';
const { ApplicationError }               = require('../../../shared/application-error');
const { readAll }                        = require('../../../shared/bounded-read');
const { trustedScopes: userScopes }      = require('../../user/policies/user.policy');
const { trustedScopes: sessionScopes }   = require('../../session/policies/session.policy');
const { trustedScopes: workspaceScopes } = require('../../workspaces/policies/workspaces.policy');
const INTERNAL                           = new Set([
  'service-apigateway',
  'service-security',
  'service-directory',
  'service-customer',
  'service-supplier',
  'service-billing',
  'service-quotation',
  'service-projects',
  'service-support',
  'service-platform',
  'service-communication',
  'service-connect',
  'service-documents',
  'service-intelligence',
]);
/**
 * Compone identidad, perfiles, búsqueda y membresía con consultas uniformes para los servicios autorizados.
 * @param {Object} options Colaboradores u opciones: messaging, users, sessions, workspaces.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function identityService({
  authorization,
  messaging,
  users,
  sessions,
  workspaces,
  groups,
  policies,
  authenticateAgent,
  authenticateDelegation,
}) {
  /**
   * Ejecuta active dentro del flujo de identity.service.
   * @param {boolean} [includeUnconfirmed=false] Incluye cuentas vigentes pendientes sólo para selección.
   * @returns {Object} Filtro canónico; el acceso conserva la consulta activa predeterminada.
   */
  const active = (includeUnconfirmed = false) => ({
    erased   : false,
    state    : includeUnconfirmed ? { $in: ['active', 'registered'] } : 'active',
    validity : { $gt: Date.now() },
  });
  /**
   * Ejecuta origin dentro del flujo de identity.service.
   * @param {string} source Valor de source utilizado por esta operación.
   * @returns {void} Finaliza después de aplicar los efectos de la operación.
   */
  function origin(source) {
    if (!INTERNAL.has(source)) throw new ApplicationError(403, 'FORBIDDEN');
  }
  /**
   * Ejecuta codes dentro del flujo de identity.service.
   * @param {Array<*>} values Valores que participan en la transformación.
   * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  function codes(values) {
    if (
      !Array.isArray(values) ||
      values.length > 100 ||
      values.some(
        /**
         * Comprueba si el elemento satisface la condición.
         * @param {*} value Valor de value utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (value) => typeof value !== 'string' || !value || value.length > 100,
      )
    )
      throw new ApplicationError(400, 'INVALID_INPUT');
    return [...new Set(values)];
  }
  /**
   * Ejecuta current dentro del flujo de identity.service.
   * @param {string} source Valor de source utilizado por esta operación.
   * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { current }         =
    require('../services/identity-authorization.service').identityAuthorizationService({
      authenticateAgent,
      authenticateDelegation,
      ApplicationError,
      authorization,
      messaging,
      origin,
    });
  /**
   * Ejecuta contactProfiles dentro del flujo de identity.service.
   * @param {Object[]} rows Filas obtenidas de persistencia o de una consulta.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { contactProfiles } =
    require('../services/identity-contact-profiles.service').identityContactProfilesService({
      ApplicationError,
      messaging,
    });
  const principals          = require('./identity-principals.service').identityPrincipalsService({
    ApplicationError,
    origin,
    codes,
    active,
    users,
    groups,
    policies,
    workspaces,
    userScopes,
    workspaceScopes,
    readAll,
    groupScopes  : require('../../group/policies/group.policy').trustedScopes,
    policyScopes : require('../../policy/policies/policy.policy').trustedScopes,
  });
  return {
    current,
    ...require('./identity-personal-principals.service').identityPersonalPrincipalsService({
      origin,
      codes,
      active,
      users,
      groups,
      policies,
      workspaces,
      userScopes,
      workspaceScopes,
      readAll,
      groupScopes  : require('../../group/policies/group.policy').trustedScopes,
      policyScopes : require('../../policy/policies/policy.policy').trustedScopes,
    }),
    ...principals,
    ...require('./identity-own-access.service').identityOwnAccessService({
      current,
      principals : principals.principals,
      messaging,
      users,
      sessions,
      workspaces,
      userScopes,
      sessionScopes,
      workspaceScopes,
    }),
    ...require('./identity-references.service').identityReferencesService({
      codes,
      current,
      users,
      userScopes,
      contactProfiles,
    }),
    ...require('./identity-profiles.service').identityProfilesService({
      ApplicationError,
      codes,
      contactProfiles,
      current,
      messaging,
      userScopes,
      users,
    }),
    ...require('./identity-picture.service').identityPictureService({
      ApplicationError,
      codes,
      current,
      messaging,
      userScopes,
      users,
    }),
    ...require('./identity-active-profiles.service').identityActiveProfilesService({
      origin,
      codes,
      active,
      users,
      userScopes,
      readAll,
      contactProfiles,
      ApplicationError,
    }),
    ...require('./identity-directory.service').identityDirectoryService({
      ApplicationError,
      active,
      codes,
      contactProfiles,
      current,
      readAll,
      userScopes,
      users,
    }),
    ...require('./identity-membership.service').identityMembershipService({
      current,
      messaging,
      ApplicationError,
      active,
      codes,
      origin,
      userScopes,
      users,
      workspaceScopes,
      workspaces,
    }),
  };
}
module.exports = { identityService };
