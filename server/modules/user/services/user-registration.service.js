/** @file Casos de uso de registro de usuarios; conserva permisos, resultados y efectos del contrato vigente. */
'use strict';
const { userPresenter }                       = require('../presenters/user.presenter');
const { registrationPhone, registrationName } = require('../dtos/registration-input');
/** Compone exclusivamente las operaciones de registro con colaboradores explícitos.
 * @param {Object} dependencies Capacidades requeridas por estas operaciones; no construye adaptadores.
 * @returns {Object} Operaciones de registro con el mismo contrato público.
 */
function userRegistrationService({
  ApplicationError,
  confirmationSettings,
  confirmationToken,
  controller,
  counter,
  roleDefaults,
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
}) {
  return {
    /** Registro público: el servidor elige guest y resuelve las membresías globales de clientes y transportistas.
     * @param {Object} data Datos de entrada de la operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async register(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      if (typeof data.workspaceCode !== 'string' || !data.workspaceCode)
        throw new ApplicationError(400, 'WORKSPACE_REQUIRED');
      if (!['100-customer', '300-supplier'].includes(data.roleCode))
        throw new ApplicationError(403, 'REGISTRATION_ROLE_FORBIDDEN');
      if (
        Object.hasOwn(data, 'contactCode') ||
        (data.groups !== undefined && (!Array.isArray(data.groups) || data.groups.length)) ||
        ['userCreate', 'userAssigned', 'workspace', 'workspaces'].some(
          /**
           * Comprueba si el elemento satisface la condición.
           * @param {string} field Campo utilizado por la operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (field) => Object.hasOwn(data, field),
        )
      )
        throw new ApplicationError(403, 'GROUP_ASSIGNMENT_FORBIDDEN');
      const sharedRegistration = data.workspaceCode === 'allWorkspaces';
      let registrationWorkspaces;
      if (sharedRegistration) {
        const result = await utilities.collectPages(
          /** Lee todas las páginas de espacios vigentes antes de crear la cuenta.
           * @param {Object} pagination Página y tamaño internos.
           * @returns {Promise<Object>} Página de espacios, sin efectos de escritura.
           */
          (pagination) =>
            workspacesService(dependencies).getList(
              {
                condition : { erased: false },
                sort      : 'workspaceCode',
                order     : 'asc',
                ...pagination,
              },
              workspacesScopes.guest,
            ),
        );
        registrationWorkspaces = result.items.map(
          /** Extrae únicamente una membresía concreta comprobada por Security.
           * @param {Object} item Espacio leído del repositorio autorizado.
           * @returns {string} Código del espacio vigente.
           */
          (item) => item.workspaceCode,
        );
        if (
          !registrationWorkspaces.length ||
          registrationWorkspaces.some(
            /** Rechaza catálogos incompletos o marcadores que no son espacios reales.
             * @param {unknown} code Código leído del catálogo.
             * @returns {boolean} Si el código no puede asignarse como membresía.
             */
            (code) => typeof code !== 'string' || !code.trim() || code === 'allWorkspaces',
          ) ||
          new Set(registrationWorkspaces).size !== registrationWorkspaces.length
        )
          throw new ApplicationError(503, 'REGISTRATION_WORKSPACES_UNAVAILABLE');
      }
      return this.create(
        {
          user          : data.user,
          roleCode      : data.roleCode,
          name          : registrationName(data.name),
          phone         : registrationPhone(data.phone),
          picture       : data.picture,
          workspaceCode : sharedRegistration ? registrationWorkspaces[0] : data.workspaceCode,
          ...(sharedRegistration
            ? {
                workspace  : 'allWorkspaces',
                workspaces : registrationWorkspaces,
              }
            : {}),
        },
        userScopes.guest,
      );
    },
    /**
     * Crea el registro y devuelve el resultado de la operación.
     * @param {Object} data Datos de entrada de la operación.
     * @param {*} internalScope Valor de internalScope utilizado por esta operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async create(data, internalScope) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        if (typeof data.user !== 'string' || !data.user.trim()) {
          throw new ApplicationError(400, `${id}-${controller}-E0001:Email is required`);
        }
        data.user = data.user.toLowerCase().trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.user))
          throw new ApplicationError(400, 'INVALID_EMAIL');
        if (typeof data.roleCode !== 'string' || !data.roleCode.trim()) {
          throw new ApplicationError(400, `${id}-${controller}-E0002:roleCode is required`);
        }
        if (
          data.groups !== undefined &&
          (!Array.isArray(data.groups) ||
            data.groups.some(
              /**
               * Comprueba si el elemento satisface la condición.
               * @param {*} group Valor de group utilizado por esta operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (group) => typeof group !== 'string',
            ))
        )
          throw new ApplicationError(400, 'INVALID_GROUPS');
        const isRegistration = internalScope === userScopes.guest;
        const requestedScope = isRegistration
          ? userScopes.guest
          : data.scope === undefined
            ? ''
            : data.scope;
        const workspaceCode  =
          data.workspaceCode === undefined ? system.workspace : data.workspaceCode;
        const workspace      = isRegistration
          ? (data.workspace ?? workspaceCode)
          : data.workspace === undefined
            ? system.workspace
            : data.workspace;
        if (
          typeof workspace !== 'string' ||
          !workspace ||
          typeof workspaceCode !== 'string' ||
          !workspaceCode ||
          workspaceCode === 'allWorkspaces'
        )
          throw new ApplicationError(400, 'WORKSPACE_REQUIRED');
        const creationData           = {
          ...data,
          workspace,
        };
        const authorizedCreation     = userPolicy.authorize(
          'create',
          creationData,
          requestedScope,
          system,
        );
        const authorizedReactivation = isRegistration
          ? null
          : userPolicy.authorize('update', { user: data.user }, requestedScope, {
              ...system,
              changes : creationData,
            });
        if (!authorizedCreation && !authorizedReactivation)
          throw new ApplicationError(403, 'FORBIDDEN');
        if (
          data.name !== undefined &&
          (!data.name ||
            typeof data.name !== 'object' ||
            Array.isArray(data.name) ||
            ['firstName', 'lastNamePaternal', 'lastNameMaternal'].some(
              /**
               * Comprueba si el elemento satisface la condición.
               * @param {string} field Campo utilizado por la operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (field) => data.name[field] !== undefined && typeof data.name[field] !== 'string',
            ))
        )
          throw new ApplicationError(400, 'INVALID_NAME');
        if (data.picture !== undefined && typeof data.picture !== 'string')
          throw new ApplicationError(400, 'INVALID_PICTURE');
        if (
          data.validity !== undefined &&
          data.validity !== '' &&
          (typeof data.validity !== 'number' ||
            !Number.isFinite(data.validity) ||
            data.validity <= Date.now())
        )
          throw new ApplicationError(400, 'INVALID_VALIDITY');
        // Las membresías son concretas; una cuenta pública compartida conserva ámbito global.
        const authorizedRegistrationWorkspace = authorizedCreation
          ? userPolicy.authorize(
              'create',
              {
                ...creationData,
                workspace : workspaceCode,
              },
              requestedScope,
              system,
            )
          : userPolicy.authorize('update', { user: data.user }, requestedScope, {
              ...system,
              changes : { workspace: workspaceCode },
            });
        if (!authorizedRegistrationWorkspace)
          throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
        for (const code of new Set(
          workspace === 'allWorkspaces' ? [workspaceCode] : [workspace, workspaceCode],
        )) {
          const workspaceValue = await workspacesService(dependencies).getOne(
            {
              workspaceCode : code,
              erased        : false,
            },
            workspacesScopes.guest,
          );
          if (!workspaceValue) throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
        }
        const userSetings   = await confirmationSettings();
        const configuration = await platformInformation.read();
        if (data.validity == undefined || data.validity == '') {
          const now = new Date();
          now.setFullYear(now.getFullYear() + 1);
          data.validity = now.getTime();
        }
        /**
         * La identidad visual de Platform se obtuvo antes de modificar el usuario.
         */
        const user          = await userRepository.getOne(
          {
            user : data.user,
          },
          userScopes.guest,
        );
        const creationInput = user ? data : authorizedCreation;
        if (!creationInput) throw new ApplicationError(403, 'GROUP_ASSIGNMENT_FORBIDDEN');
        const groups =
          creationInput.groups !== undefined
            ? creationInput.groups
            : user
              ? [...user.groups]
              : userSetings?.data?.defaultGroupsByRole === undefined
                ? []
                : await roleDefaults.resolve(userSetings, data.roleCode);
        const body   = {
          userCode             : '',
          contactCode          : '',
          code                 : '',
          user                 : data.user,
          roleCode             : data.roleCode,
          validity             : data.validity,
          groups,
          workspaces           : isRegistration
            ? (data.workspaces ?? [workspaceCode])
            : (creationInput.workspaces ?? [workspaceCode]),
          workspace,
          userCreate           : typeof system.user?.userCode === 'string' ? system.user.userCode : '',
          userAssigned         : creationInput.userAssigned ?? '',
          password             : '',
          erased               : false,
          numberAttemptsAccess : 0,
        };
        if (user) {
          if (user.state == 'registered' || user.erased) {
            if (!authorizedReactivation) throw new ApplicationError(403, 'FORBIDDEN');
            if (!user.contactCode || user.contactCode !== user.userCode)
              throw new ApplicationError(409, 'INVALID_CONTACT_LINK');
            const profile = await messaging.request(
              'service-directory',
              'contact-profile-get-one',
              {
                contactCode : user.contactCode,
              },
            );
            if (profile.statusCode !== 200 || !profile.data)
              throw new ApplicationError(
                profile.statusCode >= 500 ? 503 : 409,
                'INVALID_CONTACT_LINK',
              );
            body.userCode = user.userCode;
            body.contactCode = user.contactCode;
            body.userCreate = user.userCreate;
            body.userAssigned = data.userAssigned ?? user.userAssigned;
            body.workspace = data.workspace ?? user.workspace;
            body.state = 'registered';
            body.activationToken = confirmationToken(body.userCode, system, userSetings);
            body.updateDate = Date.now();
            ((body.code = user.code), (body.erased = false));
            userState.document = await userRepository.update(
              {
                $and : [
                  authorizedReactivation,
                  {
                    _id             : user._id,
                    state           : user.state,
                    erased          : user.erased,
                    activationToken : user.activationToken,
                  },
                ],
              },
              body,
              requestedScope,
            );
            if (!userState.document) throw new ApplicationError(409, 'USER_CHANGED');
            effectsCompleted = true;
          } else {
            throw new ApplicationError(409, `${id}-${controller}-E0003:User exist`);
          }
        } else {
          if (Object.hasOwn(data, 'contactCode'))
            throw new ApplicationError(400, 'CONTACT_CODE_FORBIDDEN');
          body.code = await counter.getObjectCode('USR', 'code');
          const contactService = await messaging.request('service-directory', 'contact-register', {
            phone         : data.phone,
            name          : data.name ?? {
              firstName        : '',
              lastNamePaternal : '',
              lastNameMaternal : '',
            },
            roleCode      : data.roleCode,
            picture       : data.picture,
            email         : body.user,
            workspaceCode :
              isRegistration && workspace === 'allWorkspaces' ? 'allWorkspaces' : workspaceCode,
          });
          if (contactService.statusCode !== 201) {
            throw new ApplicationError(
              contactService.statusCode >= 400 ? contactService.statusCode : 502,
              'CONTACT_CREATION_FAILED',
              { uncertain: contactService.statusCode >= 500 },
            );
          }
          effectsCompleted = true;
          if (
            typeof contactService.data?.contactCode !== 'string' ||
            !contactService.data.contactCode.trim() ||
            contactService.data.userCode !== contactService.data.contactCode
          )
            throw new ApplicationError(502, 'INVALID_CONTACT_RESPONSE');
          body.contactCode = contactService.data.contactCode;
          body.userCode = body.contactCode;
          if (isRegistration) {
            body.userCreate = body.userCode;
            body.userAssigned = body.userCode;
          }
          body.activationToken = confirmationToken(body.userCode, system, userSetings);
          body.updateDate = Date.now();
          userState.document = await userRepository.create(body, requestedScope);
          effectsCompleted = true;
        }
        if (
          Array.isArray(data.workspaces) &&
          !utilities.arraysAreEqual(userState.document.workspaces, data.workspaces)
        ) {
          await messaging.publishEvent(`security.user.update.workspaces`, {
            code       : userState.document.userCode,
            workspaces : data.workspaces,
          });
        }
        await messaging.publishEvent(`security.user.create`, userPresenter(userState.document));

        const activationLink = `${configuration.publicUrl}/confirm/${userState.document.activationToken}`;
        await messaging.sendCommand('service-connect', 'email-send-transactional', {
          template      : 'security-user-confirm',
          workspaceCode :
            isRegistration && workspace === 'allWorkspaces'
              ? workspaceCode
              : userState.document.workspace,
          email         : userState.document.user,
          data          : JSON.stringify({
            token   : activationLink,
            company : configuration.title,
          }),
        });
        return userState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
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
          `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : effectsCompleted || err?.uncertain === true,
          },
        );
      }
    },
  };
}
module.exports = { userRegistrationService };
