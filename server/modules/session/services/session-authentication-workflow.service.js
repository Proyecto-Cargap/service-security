/** @file Casos de uso de autenticación del recurso session; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de autenticación con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function sessionAuthenticationWorkflowService({
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
}) {
  /**
   * Valida credencial, cuenta y workspace y reconstruye el acceso actual; sólo la renovación explícita escribe o firma otra credencial.
   * @param {Object} data Credencial de sesión aportada por el transporte autenticado.
   * @param {boolean} rotateCredential Activa exclusivamente los efectos de renovación.
   * @returns {Promise<Object>} Sesión actual validada con perfil y permisos vigentes.
   */
  async function restoreSnapshot(data, rotateCredential) {
    {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new ApplicationError(400, 'INVALID_INPUT');
    }
    let effectsCompleted = false;
    try {
      const system = messaging.getContext();
      let claims;
      try {
        if (typeof data.code !== 'string' || !data.code || data.code.length > 16384)
          throw new Error();
        claims = jwt.verify(data.code, dependencies.tokenSecret, {
          algorithms : ['HS256'],
          ...tokenContexts.session,
        });
        if (
          typeof claims?.user?.userCode !== 'string' ||
          !claims.user.userCode ||
          !Number.isFinite(claims.exp)
        )
          throw new Error();
      } catch {
        throw new ApplicationError(401, 'INVALID_SESSION');
      }

      const sessionSetings = rotateCredential
        ? await settingsRepository.get('session-setings', settingsScopes.guest)
        : null;
      sessionState.document = null;
      sessionState.document = await sessionRepository.getOne(
        {
          token    : data.code,
          userCode : claims.user.userCode,
        },
        sessionScopes.guest,
      );
      if (!sessionState.document) {
        throw new ApplicationError(rotateCredential ? 400 : 401, 'INVALID_SESSION');
      }
      if (!sessionState.document.active) {
        throw new ApplicationError(401, `${id}-${controller}-E0001:Session expired`);
      }
      if (sessionState.document.expiration < new Date().getTime() / 1000) {
        if (rotateCredential) {
          sessionState.document.active = false;
          sessionState.document.end = new Date().getTime();
          await sessionRepository.updateItem(sessionState.document, sessionScopes.guest);
          effectsCompleted = true;
        }
        throw new ApplicationError(401, `${id}-${controller}-E0001:Session expired`);
      }
      const userServiceInstance = userService(dependencies);
      const user                = await userServiceInstance.getOne(
        {
          userCode : sessionState.document.userCode,
          state    : 'active',
          erased   : false,
        },
        userScopes.guest,
      );
      const activeWorkspace     = sessionState.document.activeWorkspace;
      if (
        !user ||
        ['agent', 'external'].includes(user.userType) ||
        user.state !== 'active' ||
        user.erased ||
        Number(user.validity) <= Date.now() ||
        (Number(claims.credentialsChangedAt) || 0) !== (Number(user.credentialsChangedAt) || 0) ||
        typeof activeWorkspace !== 'string' ||
        !activeWorkspace ||
        activeWorkspace === 'allWorkspaces' ||
        !Array.isArray(user.workspaces) ||
        !user.workspaces.includes(activeWorkspace)
      )
        throw new ApplicationError(401, 'INVALID_SESSION');
      const effectiveWorkspaces = rotateCredential
        ? user.workspaces
        : user.workspaces.filter(
            /** @param {string} code Membresía actual de la cuenta. @returns {boolean} Conserva únicamente el acceso todavía asignado a esta sesión. */
            (code) =>
              Array.isArray(sessionState.document.workspaces) &&
              sessionState.document.workspaces.includes(code),
          );
      if (!effectiveWorkspaces.includes(activeWorkspace))
        throw new ApplicationError(401, 'INVALID_SESSION');
      const selectedWorkspace = await workspacesService(dependencies).getOne(
        {
          workspaceCode : activeWorkspace,
          erased        : false,
        },
        workspacesScopes.guest,
      );
      if (!selectedWorkspace) throw new ApplicationError(401, 'INVALID_SESSION');
      const authorization = rotateCredential
        ? jwt.sign(
            {
              idTransaction        : system.idTransaction,
              user                 : userPresenter(user),
              credentialsChangedAt : Number(user.credentialsChangedAt) || 0,
            },
            dependencies.tokenSecret,
            {
              ...tokenContexts.session,
              algorithm : 'HS256',
              expiresIn : sessionSetings.data.tokenSessionExpiration,
            },
          )
        : data.code;
      let expiration;
      expiration = rotateCredential
        ? jwt.decode(authorization).exp
        : Math.min(claims.exp, sessionState.document.expiration);
      const groupServiceInstance = groupService(dependencies);
      const groupValue           = await utilities.collectPages(
        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @param {*} pagination Valor de pagination utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (pagination) =>
          groupServiceInstance.getList(
            {
              ...{
                condition : {
                  groupCode : {
                    $in : user.groups,
                  },
                },
                fields    : 'policies',
              },
              ...pagination,
            },
            groupScopes.guest,
          ),
      );
      let policiesToFind         = [];
      groupValue.items.forEach(
        /**
         * Aplica la operación indicada a cada elemento de la colección.
         * @param {*} group Valor de group utilizado por esta operación.
         * @returns {void} Finaliza después de aplicar los efectos de la operación.
         */
        (group) => {
          policiesToFind = policiesToFind.concat(group.policies);
        },
      );
      const policyServiceInstance = policyService(dependencies);
      const policyValue           = await utilities.collectPages(
        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @param {*} pagination Valor de pagination utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (pagination) =>
          policyServiceInstance.getList(
            {
              ...{
                condition : {
                  policyCode : {
                    $in : policiesToFind,
                  },
                },
              },
              ...pagination,
            },
            policyScopes.guest,
          ),
      );
      const policies              = [];
      policyValue.items.forEach(
        /**
         * Aplica la operación indicada a cada elemento de la colección.
         * @param {*} item Valor de item utilizado por esta operación.
         * @returns {void} Finaliza después de aplicar los efectos de la operación.
         */
        (item) => {
          if (item.active) {
            policies.push(item.identifier);
          }
        },
      );
      const contactService = await messaging.request(
        'service-directory',
        'contact-profile-get-one',
        {
          contactCode : user.contactCode || user.userCode,
        },
      );
      if (contactService?.statusCode !== 200)
        throw new ApplicationError(
          contactService?.statusCode || 503,
          contactService?.descriptionCode || 'CONTACT_PROFILE_UNAVAILABLE',
        );
      if (!contactService.data) throw new ApplicationError(404, 'CONTACT_NOT_FOUND');
      const workspacesServiceInstance = workspacesService(dependencies);
      const workspaces                = await utilities.collectPages(
        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @param {*} pagination Valor de pagination utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (pagination) =>
          workspacesServiceInstance.getList(
            {
              ...{
                condition : {
                  workspaceCode : {
                    $in : effectiveWorkspaces,
                  },
                },
                sort      : 'name',
                order     : 'asc',
              },
              ...pagination,
            },
            workspacesScopes.guest,
          ),
      );
      if (rotateCredential) {
        sessionState.document.token = authorization;
        sessionState.document.policies = policies;
        ((sessionState.document.workspaces = user.workspaces),
          (sessionState.document.expiration = expiration));
        sessionState.document.idTransaction = system.idTransaction;
        await sessionRepository.updateItem(sessionState.document, sessionScopes.guest);
        effectsCompleted = true;
      }
      return {
        authorization,
        activeWorkspace,
        sessionCode   : sessionState.document.sessionCode,
        expiration    : expiration,
        policies      : policies,
        user          : {
          userCode   : user.userCode,
          user       : user.user,
          groups     : user.groups,
          workspaces : workspaces.items.map(workspacesPresenter),
          roleCode   : user.roleCode,
          state      : user.state,
          validity   : user.validity,
          name       : contactService.data.name,
          picture    : contactService.data.picture,
        },
        idTransaction : system.idTransaction,
      };
    } catch (err) {
      if (err instanceof ApplicationError) {
        if (effectsCompleted) err.uncertain = true;
        throw err;
      }
      logger.error({
        component : 'service',
        event     : 'handler_failed',
        code      : 'INTERNAL_ERROR',
      });
      throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
        cause     : err,
        uncertain : effectsCompleted || err?.uncertain === true,
      });
    }
  }
  return {
    /**
     * Autentica al usuario, consulta la configuración y crea la sesión con sus datos de acceso.
     * Consulta mediante RPC la acción contact-profile-get-one del servicio service-directory.
     * Devuelve datos de aplicación o propaga ApplicationError.
     *
     * @param {Object} data Datos de sesiones que utiliza user, password.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async create(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        if (
          data.workspaceCode !== undefined &&
          (typeof data.workspaceCode !== 'string' ||
            !data.workspaceCode.trim() ||
            data.workspaceCode === 'allWorkspaces')
        )
          throw new ApplicationError(400, 'WORKSPACE_REQUIRED');
        const userServiceInstance = userService(dependencies);
        const sessionSetings      = await settingsRepository.get(
          'session-setings',
          settingsScopes.guest,
        );
        if (typeof data.user !== 'string' || !data.user.trim()) {
          throw new ApplicationError(400, `${id}-${controller}-E0001:User is required`);
        }
        if (typeof data.password !== 'string' || !data.password) {
          throw new ApplicationError(400, `${id}-${controller}-E0002:Password is required`);
        }
        data.user = data.user.toLowerCase().trim();
        const user = await userServiceInstance
          .getOne(
            {
              erased : false,
              user   : data.user,
            },
            userScopes.guest,
          )
          .catch(
            /**
             * Gestiona el fallo de la operación asíncrona y conserva la política de error del módulo.
             * @param {Error} error Fallo recibido por la continuación.
             * @returns {null} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
             */
            (error) => {
              if ([204, 404].includes(error.statusCode)) return null;
              throw error;
            },
          );
        if (!user) {
          throw new ApplicationError(406, `${id}-${controller}-E0003:Password / User incorrect`);
        }
        if (['agent', 'external'].includes(user.userType))
          throw new ApplicationError(
            403,
            user.userType === 'external'
              ? 'EXTERNAL_INTERACTIVE_LOGIN_FORBIDDEN'
              : 'AGENT_INTERACTIVE_LOGIN_FORBIDDEN',
          );
        await userServiceInstance.authentication(data.password);
        const assigned   = Array.isArray(user.workspaces) ? user.workspaces : [];
        const workspaces = await utilities.collectPages(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {*} pagination Valor de pagination utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (pagination) =>
            workspacesService(dependencies).getList(
              {
                ...{
                  condition : {
                    workspaceCode : { $in: assigned },
                    erased        : false,
                  },
                  sort      : 'name',
                  order     : 'asc',
                },
                ...pagination,
              },
              workspacesScopes.guest,
            ),
        );
        const available  = assigned.filter(
          /**
           * Determina si el elemento cumple el criterio de selección.
           * @param {string} code Identificador público del recurso.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (code) =>
            typeof code === 'string' &&
            code &&
            code !== 'allWorkspaces' &&
            workspaces.items.some(
              /**
               * Comprueba si el elemento satisface la condición.
               * @param {string} workspace Espacio de trabajo que delimita la operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (workspace) => workspace.workspaceCode === code,
            ),
        );
        if (!available.length) throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
        let workspaceCode = data.workspaceCode?.trim();
        if (workspaceCode && !available.includes(workspaceCode))
          throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
        if (!workspaceCode) {
          // Solo consulta preferencias del usuario cuya contraseña ya se verificó.
          const previous  = await sessionRepository.getList(
            {
              userCode : user.userCode,
              erased   : false,
            },
            {
              lastAccess : -1,
              start      : -1,
              _id        : -1,
            },
            0,
            1,
            'activeWorkspace',
            sessionScopes.guest,
          );
          const preferred = previous.listItem[0]?.activeWorkspace;
          workspaceCode = available.includes(preferred) ? preferred : available[0];
        }
        const configuration = await platformInformation.read();
        if (!sessionSetings.data.multisession) {
          const session = await sessionRepository.getOne(
            {
              userCode : user.userCode,
              active   : true,
            },
            sessionScopes.guest,
          );
          if (session) {
            session.active = false;
            session.end = new Date().getTime();
            session.idTransaction = system.idTransaction;
            await sessionRepository.updateItem(session, sessionScopes.guest);
            effectsCompleted = true;
          }
        }
        const groupServiceInstance = groupService(dependencies);
        const groupValue           = await utilities.collectPages(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {*} pagination Valor de pagination utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (pagination) =>
            groupServiceInstance.getList(
              {
                ...{
                  condition : {
                    groupCode : {
                      $in : user.groups,
                    },
                  },
                  fields    : 'policies',
                },
                ...pagination,
              },
              groupScopes.guest,
            ),
        );
        let policiesToFind         = [];
        groupValue.items.forEach(
          /**
           * Aplica la operación indicada a cada elemento de la colección.
           * @param {*} group Valor de group utilizado por esta operación.
           * @returns {void} Finaliza después de aplicar los efectos de la operación.
           */
          (group) => {
            policiesToFind = policiesToFind.concat(group.policies);
          },
        );
        const policyServiceInstance = policyService(dependencies);
        const policyValue           = await utilities.collectPages(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {*} pagination Valor de pagination utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (pagination) =>
            policyServiceInstance.getList(
              {
                ...{
                  condition : {
                    policyCode : {
                      $in : policiesToFind,
                    },
                  },
                },
                ...pagination,
              },
              policyScopes.guest,
            ),
        );
        const policies              = [];
        policyValue.items.forEach(
          /**
           * Aplica la operación indicada a cada elemento de la colección.
           * @param {*} item Valor de item utilizado por esta operación.
           * @returns {void} Finaliza después de aplicar los efectos de la operación.
           */
          (item) => {
            if (item.active) {
              policies.push(item.identifier);
            }
          },
        );
        const contactService = await messaging.request(
          'service-directory',
          'contact-profile-get-one',
          {
            contactCode : user.contactCode || user.userCode,
          },
        );
        if (contactService?.statusCode !== 200)
          throw new ApplicationError(
            contactService?.statusCode || 503,
            contactService?.descriptionCode || 'CONTACT_PROFILE_UNAVAILABLE',
          );
        if (!contactService.data) throw new ApplicationError(404, 'CONTACT_NOT_FOUND');
        const authorization = jwt.sign(
          {
            idTransaction        : system.idTransaction,
            user                 : userPresenter(user),
            credentialsChangedAt : Number(user.credentialsChangedAt) || 0,
          },
          dependencies.tokenSecret,
          {
            ...tokenContexts.session,
            algorithm : 'HS256',
            expiresIn : sessionSetings.data.tokenSessionExpiration,
          },
        );
        let expiration;
        expiration = jwt.decode(authorization).exp;
        const sessionInput = {
          sessionCode     : await counter.getObjectCode('SES'),
          token           : authorization,
          userCode        : user.userCode,
          roleCode        : user.roleCode,
          policies,
          workspaces      : user.workspaces,
          workspace       : 'allWorkspaces',
          activeWorkspace : workspaceCode,
          userCreate      : user.userCode,
          userAssigned    : user.userCode,
          expiration      : expiration,
          idTransaction   : system.idTransaction,
        };
        const users        = dependencies.repositories.user;
        const newSession   = await messaging.transaction(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {Object} session Sesión que agrupa las operaciones de persistencia.
           * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          async (session) => {
            await users.lockForSession(user.userCode, user.credentialsChangedAt, session);
            return sessionRepository.create(sessionInput, sessionScopes.guest, session);
          },
        );
        effectsCompleted = true;
        const activationLink = `${configuration.publicUrl}/close/${authorization}`;
        await messaging.sendCommand('service-connect', 'email-send-transactional', {
          template : 'security-session-create',
          workspaceCode,
          email    : user.user,
          data     : JSON.stringify({
            name    : contactService.data.name.firstName,
            company : configuration.title,
            token   : activationLink,
          }),
        });

        return {
          authorization,
          activeWorkspace : newSession.activeWorkspace,
          sessionCode     : newSession.sessionCode,
          expiration      : expiration,
          policies        : policies,
          user            : {
            userCode   : user.userCode,
            user       : user.user,
            groups     : user.groups,
            workspaces : workspaces.items.map(workspacesPresenter),
            roleCode   : user.roleCode,
            state      : user.state,
            validity   : user.validity,
            name       : contactService.data.name,
            picture    : contactService.data.picture,
          },
          idTransaction   : system.idTransaction,
        };
      } catch (err) {
        if (err instanceof ApplicationError) {
          if (effectsCompleted) err.uncertain = true;
          throw err;
        }
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(
          err.statusCode || 500,
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : effectsCompleted || err?.uncertain === true,
          },
        );
      }
    },
    /**
     * Renueva la vigencia de la sesión utilizando la configuración de autenticación disponible.
     * Consulta mediante RPC la acción contact-profile-get-one del servicio service-directory.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de sesiones que utiliza code.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async renovate(data) {
      return restoreSnapshot(data, true);
    },
    /** @param {Object} data Credencial vigente de la sesión propia. @returns {Promise<Object>} Valida y devuelve el acceso actual sin rotar, extender ni escribir la sesión. */
    async restore(data) {
      return restoreSnapshot(data, false);
    },
  };
}
module.exports = { sessionAuthenticationWorkflowService };
