/** @file Casos de uso de administración de usuarios; conserva permisos, resultados y efectos del contrato vigente. */
'use strict';
const { userPresenter } = require('../presenters/user.presenter');
/** Compone exclusivamente las operaciones de administración con colaboradores explícitos.
 * @param {Object} dependencies Capacidades requeridas por estas operaciones; no construye adaptadores.
 * @returns {Object} Operaciones de administración con el mismo contrato público.
 */
function userAdministrationService({
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
}) {
  return {
    /**
     * Localiza el registro de usuarios, aplica los cambios admitidos por esta operación y los persiste.
     * Publica el evento security.user.update.roleCode para los consumidores registrados.
     * Publica el evento security.user.update.workspaces para los consumidores registrados.
     * Envía el comando email-send-transactional al servicio service-connect.
     * Publica el evento security.user.update para los consumidores registrados.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {Object} data Datos de usuarios que utiliza state, roleCode, validity, groups, workspaces, user,
     * MQReplic.
     * @returns {Promise<*>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async update(condition, data) {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      if (Object.hasOwn(data, 'user')) {
        if (typeof data.user !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.user.trim()))
          throw new ApplicationError(400, 'INVALID_EMAIL');
        data = {
          ...data,
          user : data.user.toLowerCase().trim(),
        };
      }
      let effectsCompleted = false;
      const afterSave      = [];
      try {
        const system           = messaging.getContext();
        const requestedScope   = data.scope === undefined ? '' : data.scope;
        const authorizedFilter = userPolicy.authorize('update', condition, requestedScope, {
          ...system,
          changes : data,
        });
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        const userSetings = await settingsRepository.get('user-setings', settingsScopes.guest);
        userState.document = null;
        userState.document = await userRepository.getOne(authorizedFilter, userScopes.guest);
        if (!userState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0005:User does not exist`);
        }
        const original         = { ...userState.document };
        const previousPassword = userState.document.password;
        const previousRevision = Number(userState.document.credentialsChangedAt) || 0;
        for (const field of ['workspace', 'userAssigned']) {
          if (Object.hasOwn(data, field)) userState.document[field] = data[field];
        }
        if (data.state != undefined && data.state != '') {
          userState.document.accessBlockReason = '';
          userState.document.passwordRecoveryHash = '';
          userState.document.passwordRecoveryExpiresAt = 0;
          if (userState.document.state != data.state) {
            userState.document.numberAttemptsAccess = 0;
          }
          userState.document.state = data.state;
        }
        if (data.roleCode != undefined && data.roleCode != '') {
          if (userState.document.roleCode != data.roleCode) {
            afterSave.push(
              /**
               * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              () =>
                messaging.publishEvent(`security.user.update.roleCode`, {
                  code     : userState.document.userCode,
                  roleCode : data.roleCode,
                }),
            );
          }
          userState.document.roleCode = data.roleCode;
        }
        if (data.validity != undefined && data.validity != '') {
          const validity = new Date(data.validity);
          userState.document.validity = validity.getTime();
        }
        if (data.groups != undefined) {
          userState.document.groups = data.groups;
        }
        if (data.workspaces != undefined) {
          if (!utilities.arraysAreEqual(userState.document.workspaces, data.workspaces)) {
            afterSave.push(
              /**
               * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              () =>
                messaging.publishEvent(`security.user.update.workspaces`, {
                  code       : userState.document.userCode,
                  workspaces : data.workspaces,
                }),
            );
          }
          userState.document.workspaces = data.workspaces;
        }
        if (data.user != undefined && data.user != '') {
          if (userState.document.user != data.user) {
            const userPrev = await userRepository.getOne(
              {
                user : data.user,
              },
              userScopes.guest,
            );
            if (userPrev) {
              throw new ApplicationError(409, `${id}-${controller}-E0003:User exist`);
            }
            userState.document.state = 'registered';
            userState.document.accessBlockReason = '';
            userState.document.passwordRecoveryHash = '';
            userState.document.passwordRecoveryExpiresAt = 0;
            userState.document.user = data.user;
            userState.document.activationToken = confirmationToken(
              userState.document.userCode,
              system,
              userSetings,
            );
            const configuration  = await platformInformation.read();
            const activationLink = `${configuration.publicUrl}/confirm/${userState.document.activationToken}`;
            afterSave.push(
              /**
               * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              () =>
                messaging.sendCommand('service-connect', 'email-send-transactional', {
                  template      : 'security-user-confirm',
                  workspaceCode : userState.document.workspace,
                  email         : userState.document.user,
                  data          : JSON.stringify({
                    token   : activationLink,
                    company : configuration.title,
                  }),
                }),
            );
          }
        }
        const current = { ...userState.document };
        const changes = Object.fromEntries(
          Object.entries(current).filter(
            /**
             * Determina si el elemento cumple el criterio de selección.
             * @param {Array<*>} argument1 Valor de argument1 utilizado por esta operación.
             * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
             */
            ([key, value]) =>
              !['_id', '__v', 'userCreate'].includes(key) &&
              JSON.stringify(value) !== JSON.stringify(original[key]),
          ),
        );
        changes.updateDate = Date.now();
        const saved = await userRepository.update(
          {
            $and : [
              authorizedFilter,
              { _id: userState.document._id },
              previousPassword
                ? { password: previousPassword }
                : {
                    $or : [{ password: previousPassword ?? '' }, { password: { $exists: false } }],
                  },
              previousRevision
                ? { credentialsChangedAt: previousRevision }
                : {
                    $or : [
                      { credentialsChangedAt: 0 },
                      { credentialsChangedAt: { $exists: false } },
                    ],
                  },
            ],
          },
          { $set: changes },
          userScopes.guest,
        );
        if (!saved) throw new ApplicationError(409, 'CONCURRENT_CREDENTIAL_CHANGE');
        userState.document = saved;
        effectsCompleted = true;
        for (const publish of afterSave) await publish();
        if (data.MQReplic == undefined || data.MQReplic) {
          await messaging.publishEvent(`security.user.update`, userPresenter(userState.document));
        }

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
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : effectsCompleted || err?.uncertain === true,
          },
        );
      }
    },
    /**
     * Actualiza la relación de rol del registro y coordina las operaciones asociadas presentes en este flujo.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {Object} data Datos de usuarios que utiliza roleCode.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async updateRole(condition, data) {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        userState.document = null;
        if (
          typeof condition.userCode !== 'string' ||
          !condition.userCode ||
          typeof data.roleCode !== 'string' ||
          !data.roleCode
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
        userState.document = await userRepository.getOne(
          { userCode: condition.userCode },
          userScopes.guest,
        );
        if (!userState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0005:User does not exist`);
        }
        if (data.roleCode != undefined && data.roleCode != '') {
          userState.document.roleCode = data.roleCode;
        }
        await userRepository.updateItem(userState.document, userScopes.guest);
        effectsCompleted = true;

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
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : effectsCompleted || err?.uncertain === true,
          },
        );
      }
    },
  };
}
module.exports = { userAdministrationService };
