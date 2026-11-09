/** @file Casos de uso de confirmación de usuarios; conserva permisos, resultados y efectos del contrato vigente. */
'use strict';
const { userPresenter } = require('../presenters/user.presenter');
const { sessionDTO }    = require('../../session/dtos/session.dto');
/** Compone exclusivamente las operaciones de confirmación con colaboradores explícitos.
 * @param {Object} dependencies Capacidades requeridas por estas operaciones; no construye adaptadores.
 * @returns {Object} Operaciones de confirmación con el mismo contrato público.
 */
function userConfirmationService({
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
}) {
  return {
    /**
     * Procesa el token de confirmación y actualiza el usuario según la operación solicitada.
     * Publica el evento security.user.confirm para los consumidores registrados.
     * Envía el comando email-send-transactional al servicio service-connect.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de usuarios que utiliza password, token.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async confirm(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        if (
          typeof data.password !== 'string' ||
          Array.from(data.password).length < 8 ||
          Buffer.byteLength(data.password, 'utf8') > 72 ||
          !/\p{Lu}/u.test(data.password) ||
          !/\p{Ll}/u.test(data.password) ||
          !/\p{Nd}/u.test(data.password) ||
          !/[^\p{L}\p{N}\s]/u.test(data.password)
        ) {
          throw new ApplicationError(400, `${id}-${controller}-E0016:Password policy violation`);
        }
        if (typeof data.token !== 'string' || !data.token || data.token.length > 4096) {
          throw new ApplicationError(400, `${id}-${controller}-E0001:token is required`);
        }
        let claims;
        try {
          claims = jwt.verify(data.token, dependencies.tokenSecret, {
            algorithms : ['HS256'],
            ...tokenContexts.account_confirmation,
          });
          if (
            !claims ||
            typeof claims !== 'object' ||
            typeof claims.userCode !== 'string' ||
            !claims.userCode ||
            !Number.isFinite(claims.exp) ||
            (claims.purpose !== undefined &&
              (claims.purpose !== 'account_confirmation' ||
                typeof claims.jti !== 'string' ||
                !claims.jti)) ||
            (claims.purpose === undefined && !Number.isFinite(claims.time))
          )
            throw new Error('INVALID_CONFIRMATION');
        } catch (err) {
          if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
          if (err instanceof ApplicationError) throw err;
          throw new ApplicationError(406, `${id}-${controller}-E0010:Activation Token invalid`, {
            cause     : err,
            uncertain : err?.uncertain === true,
          });
        }
        userState.document = null;
        userState.document = await userRepository.getOne(
          {
            activationToken : data.token,
            userCode        : claims.userCode,
            state           : 'registered',
            userType        : { $nin: ['agent', 'external'] },
            validity        : { $gt: Date.now() },
            erased          : false,
          },
          userScopes.guest,
        );
        if (!userState.document) {
          throw new ApplicationError(406, `${id}-${controller}-E0010:Activation Token invalid`);
        }
        // Leer la identidad visual antes de consumir el enlace evita un fallo de configuración posterior.
        const configuration = await platformInformation.read();
        const password      = await bcrypt.hash(data.password, 10);
        userState.document = await userRepository.update(
          {
            _id             : userState.document._id,
            userCode        : claims.userCode,
            activationToken : data.token,
            state           : 'registered',
            erased          : false,
            validity        : { $gt: Date.now() },
          },
          {
            $set : {
              password,
              updateDate           : Date.now(),
              activationToken      : '',
              state                : 'active',
              numberAttemptsAccess : 0,
              idTransaction        : system.idTransaction,
            },
          },
          userScopes.guest,
        );
        if (!userState.document)
          throw new ApplicationError(406, `${id}-${controller}-E0010:Activation Token invalid`);
        effectsCompleted = true;
        const sessions = await readAll(
          /**
           * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
           * @param {number} page Índice de la página según el contrato de esta operación.
           * @param {number} perPage Cantidad máxima de elementos por página.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (page, perPage) =>
            sessionRepository.getList(
              {
                userCode : userState.document.userCode,
              },
              {
                ...{},
                _id : 1,
              },
              page,
              perPage,
              '',
              sessionScopes.guest,
            ),
        );
        for (const item of sessions.listItem) {
          item.active = false;
          item.end = new Date().getTime();
          item.idTransaction = system.idTransaction;
          await sessionRepository.updateItem(item, sessionScopes.guest);
          effectsCompleted = true;
        }

        await messaging.publishEvent(`security.user.confirm`, userPresenter(userState.document));
        await messaging.sendCommand('service-connect', 'email-send-transactional', {
          template      : 'security-user-activated',
          workspaceCode : userState.document.workspace,
          email         : userState.document.user,
          data          : JSON.stringify({
            token   : `${configuration.publicUrl}/login`,
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
          err.descriptionCode || `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : effectsCompleted || err?.uncertain === true,
          },
        );
      }
    },
    /**
     * Genera y envía nuevamente la confirmación de cuenta para el usuario indicado.
     * Envía el comando email-send-transactional al servicio service-connect.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {string} userCode Código de negocio del usuario.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async putConfirmation(userCode) {
      if (typeof userCode !== 'string' || !userCode || userCode.length > 4096)
        throw new ApplicationError(400, 'INVALID_INPUT');
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        const filter = userPolicy.authorize('update', { userCode }, '', {
          ...system,
          changes : {},
        });
        if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
        userState.document = await userRepository.getOne(filter, userScopes.guest);
        if (!userState.document) {
          throw new ApplicationError(404, 'USER_NOT_FOUND');
        }
        if (
          ['agent', 'external'].includes(userState.document.userType) ||
          userState.document.state !== 'registered' ||
          userState.document.erased ||
          userState.document.validity <= Date.now()
        )
          throw new ApplicationError(409, 'INVITATION_UNAVAILABLE');
        const userSetings   = await confirmationSettings();
        const configuration = await platformInformation.read();
        const token         = confirmationToken(userState.document.userCode, system, userSetings);
        userState.document = await userRepository.update(
          {
            $and : [
              filter,
              {
                _id             : userState.document._id,
                state           : 'registered',
                erased          : false,
                validity        : { $gt: Date.now() },
                activationToken : userState.document.activationToken,
              },
            ],
          },
          {
            $set : {
              activationToken : token,
              updateDate      : Date.now(),
              idTransaction   : system.idTransaction,
            },
          },
          '',
        );
        if (!userState.document) throw new ApplicationError(409, 'INVITATION_UNAVAILABLE');
        effectsCompleted = true;
        const activationLink = `${configuration.publicUrl}/confirm/${userState.document.activationToken}`;
        await messaging.sendCommand('service-connect', 'email-send-transactional', {
          template      : 'security-user-confirm',
          workspaceCode : userState.document.workspace,
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
module.exports = { userConfirmationService };
