/**
 * @file Catálogo de acciones y eventos propios del servicio. Relaciona cada nombre público con su
 * controlador de aplicación.
 */
'use strict';

/**
 * Compone createCatalog con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} dependencies Colaboradores explícitos de la composición.
 * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function createCatalog(dependencies) {
  const cleanup =
    require('./workspaces/compositions/picture-cleanup.composition').pictureCleanupComposition(
      dependencies,
    );
  dependencies = {
    ...dependencies,
    pictureCleanup : cleanup.repository,
  };
  const snapshot =
    dependencies.snapshot ||
    require('../adapters/mongodb/read-snapshot').readSnapshot({ mongoose: require('mongoose') });
  dependencies = {
    ...dependencies,
    settings :
      dependencies.settings ||
      require('./settings/repositories/settings.repository')({
        model     : require('./settings/models/settings.model'),
        messaging : dependencies.messaging,
      }),
  };
  dependencies = {
    ...dependencies,
    counter :
      dependencies.counter ||
      require('./counters/repositories/counters.repository')({
        model : require('./counters/models/counters.model'),
      }),
  };
  dependencies = {
    ...dependencies,
    logger : dependencies.logger || require('../telemetry').logger,
  };
  dependencies =
    require('./security/compositions/security-dependencies.composition').securityDependencies(
      dependencies,
    );
  const externalPrincipal    =
    require('./external-principal/compositions/external-principal.composition').externalPrincipalComposition(
      dependencies,
    );
  const oauth                = require('./oauth/compositions/oauth.composition').oauthComposition(dependencies);
  const settingsController   = require('./settings/controllers/settings.controller')(dependencies);
  const userController       = require('./user/controllers/user.controller')(dependencies);
  const sessionController    = require('./session/controllers/session.controller')(dependencies);
  const policyController     = require('./policy/controllers/policy.controller')(dependencies);
  const groupController      = require('./group/controllers/group.controller')(dependencies);
  const workspacesController = require('./workspaces/controllers/workspaces.controller')(
    dependencies,
  );
  const agentIdentity        = require('./agent-principal/services/agent-principal.service')(dependencies);
  const agentPrincipal       = require('./agent-principal/controllers/agent-principal.controller')({
    ...dependencies,
    agentPrincipal : agentIdentity,
  });
  const identities           = require('./identity/controllers/identity.controller').identityController({
    authorization          : dependencies.repositories.identityAuthorization,
    authenticateAgent      : agentIdentity.authenticate,
    authenticateDelegation : oauth.service.current,
    messaging              : dependencies.messaging,
    groups                 : dependencies.repositories.group,
    policies               : dependencies.repositories.policy,
    sessions               : dependencies.repositories.session,
    users                  : dependencies.repositories.user,
    workspaces             : dependencies.repositories.workspaces,
  });
  // Registro explícito: la lectura remota ocurre fuera de cualquier transacción.
  dependencies.messaging.registerAction({
    name      : 'user-deletion-email',
    version   : 1,
    execution : 'nonTransactional',
    retrySafe : true,
    handler   : require('./user/handlers/user-deletion-email.handler').userDeletionEmail({
      messaging   : dependencies.messaging,
      users       : dependencies.repositories.user,
      information : require('./settings/services/platform-configuration.service'),
    }),
  });
  const entries             = [
    ...oauth.entries,
    {
      name    : 'external-principal-provision',
      kind    : 'action',
      /** @param {Object} message Contacto y vínculo. @returns {Promise<Object>} Alta idempotente. */
      handler : (message) => externalPrincipal.provision(message),
    },
    {
      name    : 'external-principal-resolve',
      kind    : 'action',
      /** @param {Object} message Vínculo interno. @returns {Promise<Object>} Sesión breve. */
      handler : (message) => externalPrincipal.resolve(message),
    },
    {
      name    : 'user-personal-principals-get-list',
      kind    : 'action',
      /** @param {Object} message Códigos validados y origen acreditado. @returns {Promise<Object>} Permisos personales vigentes sin credenciales. */
      handler : (message) => identities.personalPrincipals(message),
    },
    {
      name    : 'user-principals-get-list',
      kind    : 'action',
      /** @param {Object} message Usuarios explícitos. @returns {Promise<Object>} Principales separados por espacio. */
      handler : (message) => identities.userPrincipals(message),
    },
    {
      name    : 'user-delivery-addresses-get-list',
      kind    : 'action',
      /** @param {Object} message Usuarios explícitos. @returns {Promise<Object>} Destinos privados vigentes. */
      handler : (message) => identities.deliveryAddresses(message),
    },
    {
      name    : 'workspace-principals-get-list',
      kind    : 'action',
      /** @param {Object} message Workspace y usuarios explícitos. @returns {Promise<Object>} Principales vigentes sin credenciales. */
      handler : (message) => identities.principals(message),
    },
    {
      name    : 'identity-get-current',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.current(message),
    },
    {
      name    : 'user-references-get-list',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.references(message),
    },
    {
      name    : 'user-profile-get-list',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.profiles(message),
    },
    {
      name    : 'user-profile-get-one',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.profile(message),
    },
    {
      name    : 'user-picture-read',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.picture(message),
    },
    {
      name    : 'user-active-profiles-get-list',
      kind    : 'action',
      /** @param {Object} message Solicitud interna de elegibilidad. @returns {Promise<Object>} Contrato canónico sin autoridad del cuerpo. */
      handler : (message) => identities.activeProfiles(message),
    },
    {
      name    : 'user-directory-get-list',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.directory(message),
    },
    {
      name    : 'workspace-users-get-list',
      kind    : 'action',

      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => identities.workspaceUsers(message),
    },
    {
      name    : 'session-own-access-get',
      kind    : 'action',
      /** @param {Object} message Contexto acreditado, sin selectores del cliente. @returns {Promise<Object>} Acceso propio actual. */
      handler : (message) => identities.ownAccess(message),
    },
    {
      name    : 'session-own-profile-get',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.ownProfile(message),
    },
    {
      name    : 'session-own-profile-picture-read',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.ownProfilePicture(message),
    },
    {
      name    : 'session-profile-picture-read',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.profilePicture(message),
    },
    {
      name    : 'agent-principal-activate',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => agentPrincipal.activate(message),
    },
    {
      name    : 'agent-principal-provision',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => agentPrincipal.provision(message),
    },
    {
      name    : 'agent-principal-resolve',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => agentPrincipal.resolve(message),
    },
    {
      name    : 'agent-principal-authenticate',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => agentPrincipal.authenticate(message),
    },
    {
      name    : 'agent-principal-audience',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => agentPrincipal.audience(message),
    },
    {
      name    : 'agent-principal-audience-batch',
      kind    : 'action',
      /** @param {Object} message Audiencias cerradas por DTO. @returns {Promise<Object>} Autorizaciones por ejecución. */
      handler : (message) => agentPrincipal.audienceBatch(message),
    },
    {
      name    : 'agent-principal-revoke',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => agentPrincipal.revoke(message),
    },

    {
      name    : 'user-reference-exists',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.checkDirectoryReference(message),
    },
    {
      name    : 'user-register',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.register(message),
    },
    {
      name    : 'session-get-one',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.getOne(message),
    },

    {
      name    : 'user-update-password',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.updatePassword(message),
    },

    {
      name    : 'session-authenticate',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.authenticate(message),
    },
    {
      name    : 'user-create',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.create(message),
    },
    {
      name    : 'user-update',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.update(message),
    },
    {
      name    : 'user-get-list',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.getList(message),
    },
    {
      name    : 'user-get-one',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.getOne(message),
    },
    {
      name    : 'user-get-one-byemail',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.getOneByemail(message),
    },
    {
      name    : 'user-put-confirmation',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.putConfirmation(message),
    },
    {
      name    : 'user-get-policy',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.getByPolicy(message),
    },
    {
      name    : 'user-recover-password',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.recoverPassword(message),
    },
    {
      name    : 'user-delete',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.delete(message),
    },
    {
      name    : 'user-confirm-user',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.confirm(message),
    },
    {
      name    : 'directory.contact.update.roleCode',
      kind    : 'event',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => userController.updateRole(message),
    },
    {
      name    : 'policy-create',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => policyController.create(message),
    },
    {
      name    : 'policy-update',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => policyController.update(message),
    },
    {
      name    : 'policy-delete',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => policyController.delete(message),
    },
    {
      name    : 'policy-get-list',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => policyController.getList(message),
    },
    {
      name    : 'policy-get-one',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => policyController.getOne(message),
    },
    {
      name    : 'policy-get-index',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => policyController.getIndex(message),
    },
    {
      name    : 'group-create',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.create(message),
    },
    {
      name    : 'group-get-list',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.getList(message),
    },
    {
      name    : 'group-get-one',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.getOne(message),
    },
    {
      name    : 'group-update',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.update(message),
    },
    {
      name    : 'group-delete',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.delete(message),
    },
    {
      name    : 'group-add-policy',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.addPolicy(message),
    },
    {
      name    : 'group-remove-policy',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => groupController.removePolicy(message),
    },
    {
      name    : 'workspaces-create',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => workspacesController.create(message),
    },
    {
      name    : 'workspaces-get-list',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => workspacesController.getList(message),
    },
    {
      name    : 'workspaces-get-one',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => workspacesController.getOne(message),
    },
    {
      name    : 'workspaces-update',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => workspacesController.update(message),
    },
    {
      name    : 'workspaces-delete',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => workspacesController.delete(message),
    },
    {
      name    : 'session-create',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.create(message),
    },
    {
      name    : 'session-get-list',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.getList(message),
    },
    {
      name    : 'session-delete',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.delete(message),
    },
    {
      name    : 'session-restore',
      kind    : 'action',
      /** @param {Object} message Credencial propia acreditada por Gateway. @returns {Promise<Object>} Acceso vigente sin rotación. */
      handler : (message) => sessionController.restore(message),
    },
    {
      name    : 'session-renovate',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.renovate(message),
    },
    {
      name    : 'session-update',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.update(message),
    },
    {
      name    : 'session-delete-by-token',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => sessionController.closeToken(message),
    },
    {
      name    : 'settings-get-one',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => settingsController.getOne(message),
    },
    {
      name    : 'settings-get-list',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => settingsController.getList(message),
    },
    {
      name    : 'settings-update',
      kind    : 'action',
      /**
       * Atiende el mensaje con el contrato y las reglas de la operación.
       * @param {Object} message Mensaje recibido con datos y contexto del transporte.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      handler : (message) => settingsController.update(message),
    },
  ];
  const catalog             = require('./security/compositions/read-consistency.composition').consistentReads(
    entries,
    snapshot,
  );
  const pictureLifecycle    = cleanup.lifecycle({
    pictures : dependencies.workspacePictures,
    logger   : dependencies.logger,
  });
  const expirationLifecycle =
    require('./session/workers/session-expiration.worker').sessionExpirationLifecycle(dependencies);
  catalog.securityLifecycle = {
    /** @returns {Promise<void>} Abre los consumidores independientes después del arranque de Messaging. */
    async start() {
      try {
        await pictureLifecycle.start();
        await expirationLifecycle.start();
        await oauth.lifecycle.start();
      } catch (error) {
        await Promise.all([
          pictureLifecycle.close(),
          expirationLifecycle.close(),
          oauth.lifecycle.close(),
        ]);
        throw error;
      }
    },
    /** @param {Object} options Plazo de cierre. @returns {Promise<void>} Libera sólo los consumidores propios de Security. */
    async close(options) {
      await Promise.all([
        pictureLifecycle.close(options),
        expirationLifecycle.close(options),
        oauth.lifecycle.close(options),
      ]);
    },
  };
  return catalog;
}
module.exports = {
  createCatalog : require('../contracts/index').catalogFactory(createCatalog),
};
