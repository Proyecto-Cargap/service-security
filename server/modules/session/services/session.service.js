/**
 * @file Operaciones de aplicación de sesiones. Coordina las validaciones y las colaboraciones necesarias
 * para cada solicitud.
 * Cada caso de uso devuelve sus datos o propaga ApplicationError con un código público estable.
 */

'use strict';
const { userPresenter }                 = require('../../user/presenters/user.presenter');
const { workspacesPresenter }           = require('../../workspaces/presenters/workspaces.presenter');
const { readAll }                       = require('../../../shared/bounded-read');
const { trustedScopes: settingsScopes } = require('../../settings/policies/settings.policy');

const { trustedScopes: groupScopes }      = require('../../group/policies/group.policy');
const { trustedScopes: policyScopes }     = require('../../policy/policies/policy.policy');
const sessionPolicy                       = require('../policies/session.policy');
const { FIELDS, sessionListDTO }          = require('../dtos/session.dto');
const { trustedScopes: sessionScopes }    = sessionPolicy;
const { trustedScopes: userScopes }       = require('../../user/policies/user.policy');
const { trustedScopes: workspacesScopes } = require('../../workspaces/policies/workspaces.policy');
/**
 * Construye una instancia de SessionService con dependencias y estado propios de la solicitud.
 *
 * @param {Object} dependencies Mensajería, contador y settings; recibe repositorio de sesiones, fábricas de casos de usuario/grupo/política/workspace, logger y capacidades explícitas de autorización.
 * @returns {Object} Instancia de SessionService; construirla no ejecuta operaciones de persistencia.
 */
module.exports = function sessionService(dependencies) {
  const { ApplicationError }                            = require('../../../shared/application-error');
  const messaging                                       = dependencies.messaging;
  const logger                                          = dependencies.logger || {
    /**
     * Ofrece el punto de extensión error sin efectos por defecto.
     * @returns {void} Finaliza después de aplicar los efectos de la operación.
     */
    error() {},
  };
  const counter                                         = dependencies.counter;
  const settingsRepository                              = dependencies.settings;
  const platformInformation                             = dependencies.platformInformation;
  const utilities                                       = require('../../../shared/general');
  const { id }                                          = require('../../../../package.json');
  const jwt                                             = dependencies.jwt;
  const tokenContexts                                   = dependencies.tokenContexts;
  const sessionRepository                               = dependencies.repositories.session;
  const userService                                     = dependencies.services?.user;
  const groupService                                    = dependencies.services?.group;
  const policyService                                   = dependencies.services?.policy;
  const workspacesService                               = dependencies.services?.workspaces;
  const controller                                      = 'C004';
  /**
   * Ejecuta administrativeFilter dentro del flujo de session.service.
   * @param {Object} condition Valor de condition utilizado por esta operación.
   * @param {string|symbol} scope Alcance solicitado o marcador interno de confianza.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { administrativeFilter, administrativeSession } =
    require('../services/session-administrative-access.service').sessionAdministrativeAccessService(
      {
        ApplicationError,
        messaging,
        sessionPolicy,
        sessionRepository,
        sessionScopes,
      },
    );
  /**
   * Ejecuta administrativeSession dentro del flujo de session.service.
   * @param {string} code Identificador público del recurso.
   * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */

  /**
   * Ejecuta detailService dentro del flujo de session.service.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  function detailService() {
    return require('./session-detail.service')({
      roleLabels : dependencies.roleLabels,
      messaging,
      users      : dependencies.repositories.user,
      workspaces : dependencies.repositories.workspaces,
    });
  }

  /**
   * Ejecuta ownProfile dentro del flujo de session.service.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  function ownProfile() {
    return require('./session-own-profile.service')({
      roleLabels : dependencies.roleLabels,
      messaging,
      sessions   : sessionRepository,
      users      : dependencies.repositories.user,
    });
  }

  const sessionState   = { document: null };
  const authentication =
    require('./session-authentication-workflow.service').sessionAuthenticationWorkflowService({
      ApplicationError,
      controller,
      counter,
      dependencies,
      groupScopes,
      groupService,
      id,
      jwt,
      logger,
      messaging,
      platformInformation,
      policyScopes,
      policyService,
      sessionRepository,
      sessionScopes,
      sessionState,
      settingsRepository,
      settingsScopes,
      tokenContexts,
      userPresenter,
      userScopes,
      userService,
      utilities,
      workspacesPresenter,
      workspacesScopes,
      workspacesService,
    });
  const queries        = require('./session-queries-workflow.service').sessionQueriesWorkflowService({
    ApplicationError,
    FIELDS,
    administrativeFilter,
    administrativeSession,
    dependencies,
    detailService,
    messaging,
    sessionListDTO,
    sessionRepository,
    utilities,
  });
  const administration =
    require('./session-administration-workflow.service').sessionAdministrationWorkflowService({
      ApplicationError,
      controller,
      dependencies,
      id,
      logger,
      messaging,
      sessionPolicy,
      sessionRepository,
      sessionScopes,
      sessionState,
      workspacesScopes,
      workspacesService,
    });
  const revocation     =
    require('./session-revocation-workflow.service').sessionRevocationWorkflowService({
      ApplicationError,
      dependencies,
      jwt,
      logger,
      messaging,
      readAll,
      sessionPolicy,
      sessionRepository,
      sessionScopes,
      sessionState,
      tokenContexts,
    });
  const profiles       = require('./session-profiles-workflow.service').sessionProfilesWorkflowService({
    ApplicationError,
    administrativeSession,
    detailService,
    ownProfile,
  });
  const authorization  =
    require('./session-authorization-workflow.service').sessionAuthorizationWorkflowService({
      ApplicationError,
      dependencies,
      jwt,
      logger,
      sessionRepository,
      tokenContexts,
    });
  return {
    ...authentication,
    ...queries,
    ...administration,
    ...revocation,
    ...profiles,
    ...authorization,
  };
};
