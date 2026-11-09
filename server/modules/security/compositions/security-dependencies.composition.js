/** @file Conecta los repositorios y capacidades técnicas de Security antes de construir sus casos de uso. */
'use strict';
const { validateSecurityDependencies }  = require('../ports/security-dependencies.port');
const { validateSecurityTokens }        = require('../ports/security-tokens.port');
const configuration                     = require('../../settings/services/platform-configuration.service');
const { tokenContexts }                 = require('../../../adapters/security/token-contexts');
const { roleDefaultsService }           = require('../../settings/services/role-defaults.service');
const { trustedScopes: settingsScopes } = require('../../settings/policies/settings.policy');
const { trustedScopes: groupScopes }    = require('../../group/policies/group.policy');
const { ApplicationError }              = require('../../../shared/application-error');
/** Compone dependencias técnicas sin iniciar conexiones ni ejecutar consultas.
 * @param {Object} dependencies Dependencias del arranque y sustituciones explícitas de pruebas.
 * @returns {Object} Colaboradores completos para los controladores y casos de uso.
 */
function securityDependencies(dependencies) {
  const messaging    = dependencies.messaging;
  const repositories = { ...dependencies.repositories };
  repositories.user =
    repositories.user ||
    require('../../user/repositories/user.repository')({
      model : dependencies.models?.user || require('../../user/models/user.model'),
      messaging,
    });
  repositories.session =
    repositories.session ||
    require('../../session/repositories/session.repository')({
      model : dependencies.models?.session || require('../../session/models/session.model'),
      messaging,
    });
  repositories.workspaces =
    repositories.workspaces ||
    require('../../workspaces/repositories/workspaces.repository')({
      queuePictures : dependencies.pictureCleanup?.enqueue,
      model         : dependencies.models?.workspaces || require('../../workspaces/models/workspaces.model'),
      userModel     : dependencies.models?.user || require('../../user/models/user.model'),
      sessionModel  : dependencies.models?.session || require('../../session/models/session.model'),
      groupModel    : dependencies.models?.group || require('../../group/models/group.model'),
      policyModel   : dependencies.models?.policy || require('../../policy/models/policy.model'),

      messaging,
    });
  repositories.group =
    repositories.group ||
    require('../../group/repositories/group.repository')({
      model     : dependencies.models?.group || require('../../group/models/group.model'),
      userModel : dependencies.models?.user || require('../../user/models/user.model'),
      messaging,
    });
  repositories.policy =
    repositories.policy ||
    require('../../policy/repositories/policy.repository')({
      model      : dependencies.models?.policy || require('../../policy/models/policy.model'),
      groupModel : dependencies.models?.group || require('../../group/models/group.model'),

      messaging,
    });
  repositories.authentication =
    repositories.authentication ||
    require('../../session/repositories/session-authentication.repository').sessionAuthenticationRepository(
      {
        session   : dependencies.models?.session || require('../../session/models/session.model'),
        user      : dependencies.models?.user || require('../../user/models/user.model'),
        workspace :
          dependencies.models?.workspaces || require('../../workspaces/models/workspaces.model'),
        group     : dependencies.models?.group || require('../../group/models/group.model'),
        policy    : dependencies.models?.policy || require('../../policy/models/policy.model'),
        messaging,
      },
    );
  repositories.identityAuthorization =
    repositories.identityAuthorization ||
    require('../../identity/repositories/identity-authorization.repository').identityAuthorizationRepository(
      {
        session   : dependencies.models?.session || require('../../session/models/session.model'),
        user      : dependencies.models?.user || require('../../user/models/user.model'),
        workspace :
          dependencies.models?.workspaces || require('../../workspaces/models/workspaces.model'),
        messaging,
      },
    );
  const services = { ...dependencies.services };
  services.settings =
    services.settings || require('../../settings/services/settings.service').settingsService;
  services.userReference =
    services.userReference ||
    require('../../user/services/user-reference.service').userReferenceService;
  services.group = services.group || require('../../group/services/group.service');
  services.policy = services.policy || require('../../policy/services/policy.service');
  services.session = services.session || require('../../session/services/session.service');
  services.user = services.user || require('../../user/services/user.service');
  services.workspaces =
    services.workspaces || require('../../workspaces/services/workspaces.service');
  const roleDefaults =
    dependencies.roleDefaults ||
    roleDefaultsService({
      /** @returns {Promise<Object|null>} Configuración interna sin ampliar permisos del transporte. */
      readSettings : () => dependencies.settings.get('user-setings', settingsScopes.guest),
      /** @param {string} groupCode Perfil solicitado. @param {boolean} internal Resolución interna de una configuración autorizada.
       * @returns {Promise<Object|null>} Perfil global accesible o ausencia.
       */
      readGroup    : (groupCode, internal) =>
        repositories.group.getOne(
          {
            groupCode,
            erased    : false,
            workspace : 'allWorkspaces',
          },
          internal ? groupScopes.guest : '',
        ),
      /** @param {string} roleCode Rol que se configura. @returns {Promise<Object|null>} Rol autorizado o ausencia; conserva errores técnicos y de acceso. */
      async readRole(roleCode) {
        const response = await messaging.request('service-directory', 'role-get-one', {
          code : roleCode,
        });
        if (response.statusCode === 404 || response.statusCode === 204) return null;
        if (response.statusCode !== 200)
          throw new ApplicationError(
            response.statusCode >= 500 ? 503 : response.statusCode,
            'DEFAULT_ROLE_UNAVAILABLE',
          );
        if (!response.data || response.data.roleCode !== roleCode)
          throw new ApplicationError(503, 'DEFAULT_ROLE_UNAVAILABLE');
        return response.data;
      },
    });
  return validateSecurityTokens(
    validateSecurityDependencies({
      ...dependencies,
      repositories,
      roleDefaults,
      userReferences             : repositories.user,
      services,
      workspacePictures          :
        dependencies.workspacePictures ||
        require('../../../adapters/documents/workspace-pictures')({
          messaging,
          logger : dependencies.logger || {
            /** @returns {void} Omite registros cuando la composición aislada no recibe un observador. */
            error() {},
          },
        }),
      tokenContexts              : dependencies.tokenContexts || tokenContexts(process.env),
      tokenCryptography          :
        dependencies.tokenCryptography || require('../../../adapters/security/token-cryptography'),
      platformInformation        : dependencies.platformInformation || {
        /**
         * Consulta la configuración canónica mediante el transporte compuesto, sin valores alternativos.
         * @returns {Promise<Object>} Información validada o error público de indisponibilidad.
         */
        read() {
          return configuration.get(messaging);
        },
      },
      jwt                        : dependencies.jwt || require('jsonwebtoken'),
      passwordHasher             : dependencies.passwordHasher || require('bcrypt'),
      tokenSecret                : dependencies.tokenSecret || process.env.SEED,
      sessionLastAccessRefreshMs :
        dependencies.sessionLastAccessRefreshMs || process.env.SESSION_LAST_ACCESS_REFRESH_MS,
      roleLabels                 : dependencies.roleLabels || require('../../../adapters/directory/role-labels'),
    }),
  );
}
module.exports = { securityDependencies };
