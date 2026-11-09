/** @file Conecta la identidad externa con repositorios y capacidades canónicas de Security. */
'use strict';
/** Compone el alta y contexto externo sin iniciar listeners.
 * @param {Object} dependencies Repositorios y mensajería existentes.
 * @returns {Object} Controlador del dominio externo.
 */
function externalPrincipalComposition(dependencies) {
  const { repositories, messaging } = dependencies;
  const { principals }              = require('../../identity/services/identity.service').identityService({
    messaging,
    users      : repositories.user,
    sessions   : repositories.session,
    workspaces : repositories.workspaces,
    groups     : repositories.group,
    policies   : repositories.policy,
  });
  const service                     = require('../services/external-principal.service').externalPrincipalService({
    users          : repositories.user,
    sessions       : repositories.session,
    workspaces     : repositories.workspaces,
    groups         : repositories.group,
    principals,
    userScope      : require('../../user/policies/user.policy').trustedScopes.guest,
    sessionScope   : require('../../session/policies/session.policy').trustedScopes.guest,
    workspaceScope : require('../../workspaces/policies/workspaces.policy').trustedScopes.guest,
    groupScope     : require('../../group/policies/group.policy').trustedScopes.guest,
    now            : Date.now,
    fingerprint    : dependencies.tokenCryptography.fingerprint,
  });
  return require('../controllers/external-principal.controller').externalPrincipalController({
    service,
    messaging,
  });
}
module.exports = { externalPrincipalComposition };
