/** @file Identidades de agentes y credenciales de ejecución con permisos consultados en cada uso. */
'use strict';
const { agentRevisionAttestation } = require('../policies/agent-revision.policy');
const { readAll }                  = require('../../../shared/bounded-read');

const { ApplicationError }               = require('../../../shared/application-error');
const { trustedScopes: userScopes }      = require('../../user/policies/user.policy');
const { trustedScopes: groupScopes }     = require('../../group/policies/group.policy');
const { trustedScopes: policyScopes }    = require('../../policy/policies/policy.policy');
const { trustedScopes: workspaceScopes } = require('../../workspaces/policies/workspaces.policy');

/**
 * Compone aprovisionamiento idempotente y resolución autoritativa sin sesiones humanas.
 * @param {Object} dependencies Repositorios, mensajería y clave de firma interna existente.
 * @returns {Object} Operaciones de administración y autenticación de agentes.
 */
function agentPrincipalService(dependencies) {
  const { messaging, jwt }      = dependencies;
  const repositories            = dependencies.repositories || {};
  /**
   * Ejecuta repository dentro del flujo de agent-principal.service.
   * @param {string} name Nombre del componente o recurso.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const repository              = (name) => repositories[name];
  const users                   = repository('user');
  const groups                  = repository('group');
  const policies                = repository('policy');
  const workspaces              = repository('workspaces');
  /**
   * Ejecuta secret dentro del flujo de agent-principal.service.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const secret                  = () => dependencies.tokenSecret;
  /**
   * Ejecuta code dentro del flujo de agent-principal.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { code, codes, origin } = require('../policies/agent-input.policy').agentInputPolicy({
    ApplicationError,
  });
  /**
   * Ejecuta codes dentro del flujo de agent-principal.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */

  /**
   * Ejecuta origin dentro del flujo de agent-principal.service.
   * @param {string} source Valor de source utilizado por esta operación.
   * @param {*} [allowed] Valor de allowed utilizado por esta operación.
   * @returns {void} Finaliza después de aplicar los efectos de la operación.
   */

  /**
   * Ejecuta dto dentro del flujo de agent-principal.service.
   * @param {*} user Valor de user utilizado por esta operación.
   * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { agentPrincipalPresenter: dto }     = require('../presenters/agent-principal.presenter');
  /**
   * Ejecuta current dentro del flujo de agent-principal.service.
   * @param {*} agentCode Valor de agentCode utilizado por esta operación.
   * @param {string} workspace Espacio de trabajo que delimita la operación.
   * @param {*} runCode Valor de runCode utilizado por esta operación.
   * @param {*} [initiatedByUserCode] Valor de initiatedByUserCode utilizado por esta operación.
   * @param {*} confirmedRevision Valor de confirmedRevision utilizado por esta operación.
   * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const current                              = require('./agent-current.service').agentCurrentService({
    ApplicationError,
    code,
    groupScopes,
    groups,
    messaging,
    policies,
    policyScopes,
    readAll,
    userScopes,
    users,
    workspaceScopes,
    workspaces,
  });
  const { tokenCryptography, tokenContexts } = dependencies;
  const agentLifecycle                       = require('./agent-lifecycle.service').agentLifecycleService({
    ApplicationError,
    code,
    dto,
    messaging,
    origin,
    userScopes,
    users,
  });
  const agentProvisioning                    = require('./agent-provisioning.service').agentProvisioningService({
    ApplicationError,
    code,
    codes,
    dto,
    groups,
    messaging,
    origin,
    tokenCryptography,
    userScopes,
    users,
    workspaceScopes,
    workspaces,
  });
  const agentAudience                        = require('./agent-audience.service').agentAudienceService({
    ApplicationError,
    codes,
    current,
    groupScopes,
    groups,
    origin,
    policies,
    policyScopes,
    readAll,
    userScopes,
    users,
  });
  const agentCredentials                     = require('./agent-credentials.service').agentCredentialsService({
    ApplicationError,
    agentRevisionAttestation,
    current,
    jwt,
    origin,
    secret,
    tokenContexts,
  });
  return {
    ...agentLifecycle,
    ...agentProvisioning,
    ...agentAudience,
    ...agentCredentials,
  };
}
module.exports = agentPrincipalService;
