/** @file Recuperación pública con tokens de un solo uso y límites persistidos por cuenta. */
'use strict';
const { userPresenter }                = require('../presenters/user.presenter');
const { readAll }                      = require('../../../shared/bounded-read');
const { ApplicationError }             = require('../../../shared/application-error');
const { trustedScopes: userScopes }    = require('../policies/user.policy');
const { trustedScopes: sessionScopes } = require('../../session/policies/session.policy');
const { sessionDTO }                   = require('../../session/dtos/session.dto');
const MINUTE                           = 60000;
const HOUR                             = 60 * MINUTE;
/**
 * Ejecuta eligible dentro del flujo de user-password-recovery.
 * @param {*} now Valor de now utilizado por esta operación.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
const eligible                         = (now) => ({
  erased   : false,
  userType : { $nin: ['agent', 'external'] },
  validity : { $gt: now },
  $or      : [
    { state: 'active' },
    {
      state             : 'blocked',
      accessBlockReason : 'failed_attempts',
    },
  ],
});
/**
 * Ejecuta prior dentro del flujo de user-password-recovery.
 * @param {string} field Campo utilizado por la operación.
 * @param {*} value Valor de value utilizado por esta operación.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
const prior                            = (field, value) =>
  value ? { [field]: value } : { $or: [{ [field]: value }, { [field]: { $exists: false } }] };
/**
 * Compone createRecovery con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} options Colaboradores u opciones: userRepository, sessionRepository, messaging, jwt, bcrypt, tokenSecret, tokenCryptography, tokenContexts, platformInformation, logger.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = function createRecovery({
  userRepository,
  sessionRepository,
  messaging,
  jwt,
  bcrypt,
  tokenSecret,
  tokenCryptography,
  tokenContexts,
  platformInformation,
  logger,
}) {
  return {
    /** Acepta solicitudes sin revelar identidad, estado ni límites de envío de la cuenta.
     * @param {Object} data Datos de entrada de la operación.
     * @returns {Promise<null>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async request(data) {
      if (
        !data ||
        typeof data.user !== 'string' ||
        data.user.trim().length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.user.trim())
      )
        throw new ApplicationError(400, 'INVALID_EMAIL');
      const now  = Date.now();
      const user = data.user.trim().toLowerCase();
      const row  = await userRepository.getOne(
        {
          user,
          ...eligible(now),
        },
        userScopes.guest,
      );
      if (!row) return null;
      const last  = Number(row.passwordRecoveryLastRequestedAt) || 0;
      const start = Number(row.passwordRecoveryWindowStart) || 0;
      const count = Number(row.passwordRecoveryRequests) || 0;
      if (now - last < MINUTE || (now - start < HOUR && count >= 5)) return null;
      try {
        const configuration = await platformInformation.read();
        const token         = jwt.sign(
          {
            purpose  : 'password_recovery',
            userCode : row.userCode,
            jti      : tokenCryptography.identifier(),
          },
          tokenSecret,
          {
            algorithm : 'HS256',
            ...tokenContexts.password_recovery,
            expiresIn : '30m',
          },
        );
        const saved         = await userRepository.update(
          {
            _id  : row._id,
            user,
            ...eligible(now),
            $and : [
              prior('password', row.password ?? ''),
              prior('passwordRecoveryLastRequestedAt', last),
              prior('passwordRecoveryWindowStart', start),
              prior('passwordRecoveryRequests', count),
            ],
          },
          {
            $set : {
              passwordRecoveryHash            : tokenCryptography.fingerprint(token),
              passwordRecoveryExpiresAt       : now + 30 * MINUTE,
              passwordRecoveryLastRequestedAt : now,
              passwordRecoveryWindowStart     : now - start < HOUR ? start : now,
              passwordRecoveryRequests        : now - start < HOUR ? count + 1 : 1,
            },
          },
          userScopes.guest,
        );
        if (!saved) return null;
        await messaging.sendCommand('service-connect', 'email-send-transactional', {
          template      : 'security-password-change',
          workspaceCode : saved.workspace,
          email         : saved.user,
          data          : JSON.stringify({
            token   : `${configuration.publicUrl}/change/${token}`,
            company : configuration.title,
          }),
        });
      } catch {
        // La respuesta pública tampoco distingue fallos de configuración o de despacho del correo.
        logger.error({
          component : 'service',
          event     : 'password_recovery_dispatch_failed',
        });
      }
      return null;
    },
    /** Consume la autorización de recuperación antes de cerrar sesiones y publicar efectos.
     * @param {Object} data Datos de entrada de la operación.
     * @returns {Promise<null>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async reset(data) {
      const password = data?.password;
      if (
        typeof password !== 'string' ||
        Array.from(password).length < 8 ||
        Buffer.byteLength(password, 'utf8') > 72 ||
        !/\p{Lu}/u.test(password) ||
        !/\p{Ll}/u.test(password) ||
        !/\p{Nd}/u.test(password) ||
        !/[^\p{L}\p{N}\s]/u.test(password)
      )
        throw new ApplicationError(400, 'PASSWORD_POLICY_VIOLATION');
      let claims;
      try {
        if (typeof data.token !== 'string' || !data.token || data.token.length > 4096)
          throw new Error();
        claims = jwt.verify(data.token, tokenSecret, {
          algorithms : ['HS256'],
          ...tokenContexts.password_recovery,
        });
        if (
          claims?.purpose !== 'password_recovery' ||
          typeof claims.userCode !== 'string' ||
          !claims.userCode ||
          typeof claims.jti !== 'string' ||
          !claims.jti ||
          !Number.isFinite(claims.exp)
        )
          throw new Error();
      } catch {
        throw new ApplicationError(406, 'PASSWORD_RECOVERY_INVALID');
      }
      const filter = {
        userCode                  : claims.userCode,
        passwordRecoveryHash      : tokenCryptography.fingerprint(data.token),
        passwordRecoveryExpiresAt : { $gt: Date.now() },
        ...eligible(Date.now()),
      };
      const row    = await userRepository.getOne(filter, userScopes.guest);
      if (!row) throw new ApplicationError(406, 'PASSWORD_RECOVERY_INVALID');
      const hashed = await bcrypt.hash(password, 10);
      const now    = Date.now();
      const saved  = await userRepository.update(
        {
          ...filter,
          $and                      : [prior('password', row.password ?? '')],
          passwordRecoveryExpiresAt : { $gt: now },
          ...eligible(now),
        },
        {
          $set : {
            password                  : hashed,
            state                     : 'active',
            numberAttemptsAccess      : 0,
            accessBlockReason         : '',
            passwordRecoveryHash      : '',
            passwordRecoveryExpiresAt : 0,
            credentialsChangedAt      : Math.max(now, (Number(row.credentialsChangedAt) || 0) + 1),
            updateDate                : now,
            idTransaction             : messaging.getContext().idTransaction,
          },
        },
        userScopes.guest,
      );
      if (!saved) throw new ApplicationError(406, 'PASSWORD_RECOVERY_INVALID');
      try {
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
                userCode : saved.userCode,
                active   : true,
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
        for (const session of sessions.listItem) {
          session.active = false;
          session.end = now;
          session.idTransaction = messaging.getContext().idTransaction;
          await sessionRepository.updateItem(session, sessionScopes.guest);
        }
        const item = userPresenter(saved);

        await messaging.publishEvent('security.user.update', item);
      } catch (cause) {
        throw new ApplicationError(503, 'PASSWORD_RECOVERY_EFFECTS_PENDING', {
          cause,
          uncertain : true,
        });
      }
      return null;
    },
  };
};
