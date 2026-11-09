/** @file Perfil propio de una sesión humana vigente, sin permisos administrativos ni identificadores del cliente. */
'use strict';
const { ApplicationError }             = require('../../../shared/application-error');
const { trustedScopes: sessionScopes } = require('../policies/session.policy');
const { trustedScopes: userScopes }    = require('../../user/policies/user.policy');
/**
 * Ejecuta text dentro del flujo de session-own-profile.service.
 * @param {*} value Valor de value utilizado por esta operación.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
const text                             = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** @param {Object} dependencies Repositorios propios y colaboración interna de Directory. @returns {Object} Lecturas exclusivas del contacto vinculado al actor humano. */
module.exports = function sessionOwnProfileService({ messaging, sessions, users, roleLabels }) {
  /**
   * Ejecuta account dentro del flujo de session-own-profile.service.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function account() {
    const context = messaging.getContext();
    if (
      !text(context.sessionCode) ||
      !text(context.user?.userCode) ||
      !text(context.workspace) ||
      context.workspace === 'allWorkspaces' ||
      context.actorType === 'agent' ||
      ['agent', 'external'].includes(context.user?.userType)
    )
      throw new ApplicationError(401, 'UNAUTHORIZED');
    const session = await sessions.getOne(
      {
        sessionCode : context.sessionCode,
        userCode    : context.user.userCode,
        active      : true,
        erased      : false,
        expiration  : { $gt: Date.now() / 1000 },
      },
      sessionScopes.guest,
    );
    if (!session) throw new ApplicationError(401, 'UNAUTHORIZED');
    const result = await users.getList(
      {
        userCode : session.userCode,
        erased   : false,
        state    : 'active',
      },
      {},
      0,
      1,
      'user contactCode roleCode userType workspaces',
      userScopes.guest,
    );
    const user   = result.listItem[0];
    // El perfil pertenece a la identidad: un cambio principal puede confirmarse mientras esta lectura está en vuelo.
    if (
      !user ||
      ['agent', 'external'].includes(user.userType) ||
      !user.workspaces?.includes(session.activeWorkspace) ||
      !user.workspaces.includes(context.workspace)
    )
      throw new ApplicationError(401, 'UNAUTHORIZED');
    return user;
  }
  return {
    /** @returns {Promise<Object>} Contacto vinculado, nombre, correo, rol real y ruta privada, sin credenciales. */
    async get() {
      const user = await account();
      try {
        const [roles, profile] = await Promise.all([
          roleLabels(messaging, text(user.roleCode) ? [user.roleCode] : []),
          text(user.contactCode)
            ? messaging.request(
                'service-directory',
                'contact-profile-get-one',
                { contactCode: user.contactCode },
                { timeoutMs: 5000 },
              )
            : Promise.resolve({
                statusCode : 200,
                data       : null,
              }),
        ]);
        if (
          profile?.statusCode !== 200 ||
          (profile.data !== null &&
            (!profile.data ||
              typeof profile.data.fullName !== 'string' ||
              typeof profile.data.hasPicture !== 'boolean'))
        )
          throw new Error('INVALID_SESSION_PROFILE_RESPONSE');
        return {
          contactCode     : text(user.contactCode),
          pictureRevision : profile.data?.revision || 0,
          fullName        : text(profile.data?.fullName),
          email           : text(user.user),
          roleName        : roles.get(user.roleCode) || null,
          pictureUrl      :
            profile.data?.hasPicture === true ? '/security/session/me/profile/picture' : null,
        };
      } catch (cause) {
        throw new ApplicationError(503, 'SESSION_REFERENCES_UNAVAILABLE', { cause });
      }
    },
    /** @param {Object} data Sólo admite size. @returns {Promise<Object>} Temporal y MIME privados del contacto actual. */
    async picture(data = {}) {
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).some(
          /**
           * Comprueba si el elemento satisface la condición.
           * @param {string} key Clave del campo o recurso que se procesa.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (key) => key !== 'size',
        )
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      const size = data.size ?? '200';
      if (!['original', '050', '100', '200', '300', '500', '1000'].includes(size))
        throw new ApplicationError(400, 'INVALID_IMAGE_SIZE');
      const user = await account();
      if (!text(user.contactCode)) throw new ApplicationError(404, 'CONTACT_PICTURE_NOT_FOUND');
      const result = await messaging.request(
        'service-directory',
        'contact-picture-read',
        {
          contactCode : user.contactCode,
          size,
        },
        { timeoutMs: 310000 },
      );
      if (result?.statusCode !== 200)
        throw new ApplicationError(
          result?.statusCode || 503,
          result?.descriptionCode || 'FILE_READ_FAILED',
        );
      return result.data;
    },
  };
};
