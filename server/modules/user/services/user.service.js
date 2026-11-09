/**
 * @file Operaciones de aplicación de usuarios. Coordina las validaciones y las colaboraciones necesarias
 * para cada solicitud.
 * Cada caso de uso devuelve sus datos o propaga ApplicationError con un código público estable.
 */

'use strict';
const { readAll }                       = require('../../../shared/bounded-read');
const { trustedScopes: settingsScopes } = require('../../settings/policies/settings.policy');

const { trustedScopes: policyScopes }     = require('../../policy/policies/policy.policy');
const { trustedScopes: groupScopes }      = require('../../group/policies/group.policy');
const { trustedScopes: sessionScopes }    = require('../../session/policies/session.policy');
const { trustedScopes: workspacesScopes } = require('../../workspaces/policies/workspaces.policy');
const userPolicy                          = require('../policies/user.policy');
const { trustedScopes: userScopes }       = userPolicy;
/**
 * Construye una instancia de UserService con dependencias y estado propios de la solicitud.
 *
 * @param {Object} dependencies Mensajería, contador y settings; admite repositorios/modelos de usuarios y sesiones, servicios de workspaces/grupos/políticas, logger, JWT, passwordHasher y tokenSecret.
 * @returns {Object} Instancia de UserService; construirla no ejecuta operaciones de persistencia.
 */
module.exports = function userService(dependencies) {
  const { ApplicationError }                        = require('../../../shared/application-error');
  const messaging                                   = dependencies.messaging;
  const logger                                      = dependencies.logger || {
    /**
     * Ofrece el punto de extensión error sin efectos por defecto.
     * @returns {void} Finaliza después de aplicar los efectos de la operación.
     */
    error() {},
  };
  const counter                                     = dependencies.counter;
  const settingsRepository                          = dependencies.settings;
  const platformInformation                         = dependencies.platformInformation;
  const utilities                                   = require('../../../shared/general');
  const { id }                                      = require('../../../../package.json');
  const jwt                                         = dependencies.jwt;
  const tokenContexts                               = dependencies.tokenContexts;
  const bcrypt                                      = dependencies.passwordHasher;
  const userRepository                              = dependencies.repositories.user;
  const sessionRepository                           = dependencies.repositories.session;
  const workspacesService                           = dependencies.services?.workspaces;
  const policyService                               = dependencies.services?.policy;
  const groupService                                = dependencies.services?.group;
  const controller                                  = 'C001';
  /** Verifica configuración y firma antes de crear registros o sustituir una invitación.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { confirmationSettings, confirmationToken } =
    require('../services/user-confirmation-token.service').userConfirmationTokenService({
      ApplicationError,
      tokenSecret       : dependencies.tokenSecret,
      tokenCryptography : dependencies.tokenCryptography,
      jwt,
      settingsRepository,
      settingsScopes,
      tokenContexts,
    });
  /**
   * Ejecuta confirmationToken dentro del flujo de user.service.
   * @param {string} userCode Código del usuario relacionado con la operación.
   * @param {*} system Valor de system utilizado por esta operación.
   * @param {*} settings Valor de settings utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */

  const passwordRecovery = require('./user-password-recovery')({
    userRepository,
    sessionRepository,
    messaging,
    jwt,
    bcrypt,
    logger,
    tokenSecret       : dependencies.tokenSecret,
    tokenCryptography : dependencies.tokenCryptography,
    tokenContexts,
    platformInformation,
  });
  const userState        = { document: null };
  const registration     = require('./user-registration.service').userRegistrationService({
    ApplicationError,
    confirmationSettings,
    confirmationToken,
    controller,
    counter,
    roleDefaults : dependencies.roleDefaults,
    dependencies,
    id,
    logger,
    messaging,
    platformInformation,
    userPolicy,
    userRepository,
    userScopes,
    userState,
    utilities,
    workspacesScopes,
    workspacesService,
  });
  const queries          = require('./user-queries.service').userQueriesService({
    ApplicationError,
    controller,
    dependencies,
    groupScopes,
    groupService,
    id,
    logger,
    messaging,
    policyScopes,
    policyService,
    userPolicy,
    userRepository,
    userScopes,
    userState,
    utilities,
  });
  const administration   = require('./user-administration.service').userAdministrationService({
    ApplicationError,
    confirmationToken,
    controller,
    id,
    logger,
    messaging,
    platformInformation,
    settingsRepository,
    settingsScopes,
    userPolicy,
    userRepository,
    userScopes,
    userState,
    utilities,
  });
  const credentials      = require('./user-credentials.service').userCredentialsService({
    ApplicationError,
    bcrypt,
    controller,
    id,
    messaging,
    passwordRecovery,
    settingsRepository,
    settingsScopes,
    userRepository,
    userScopes,
    userState,
  });
  const confirmation     = require('./user-confirmation.service').userConfirmationService({
    ApplicationError,
    bcrypt,
    confirmationSettings,
    confirmationToken,
    controller,
    dependencies,
    id,
    jwt,
    tokenContexts,
    logger,
    messaging,
    platformInformation,
    readAll,
    sessionRepository,
    sessionScopes,
    userPolicy,
    userRepository,
    userScopes,
    userState,
  });
  const deletion         = require('./user-removal.service').userRemovalService({
    messaging,
    sessionRepository,
    userRepository,
  });
  return {
    ...registration,
    ...queries,
    ...administration,
    ...credentials,
    ...confirmation,
    ...deletion,
  };
};
