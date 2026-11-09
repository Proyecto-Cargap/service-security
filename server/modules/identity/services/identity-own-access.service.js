/** @file Proyección de acceso propio: permisos y membresías vigentes sin credenciales ni renovación de sesión. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
/** @param {Object} dependencies Lectores canónicos, principal y contexto acreditado. @returns {Object} Lectura sin escrituras ni efectos sobre la sesión. */
function identityOwnAccessService({
  current,
  principals,
  messaging,
  users,
  sessions,
  workspaces,
  userScopes,
  sessionScopes,
  workspaceScopes,
}) {
  return {
    /** @param {Object} data Consulta vacía validada. @param {string} source Servicio acreditado. @returns {Promise<Object>} Acceso actual del actor humano, dentro de la instantánea de Security. */
    async ownAccess(data, source) {
      if (!['service-platform', 'service-apigateway'].includes(source))
        throw new ApplicationError(403, 'FORBIDDEN');
      const context = messaging.getContext();
      if (
        context.agentAuthorization ||
        context.delegation ||
        ['agent', 'external'].includes(context.user?.userType)
      )
        throw new ApplicationError(403, 'HUMAN_SESSION_REQUIRED');
      const identity = await current(source);
      const user     = await users.getOne(
        {
          userCode : identity.userCode,
          erased   : false,
          state    : 'active',
        },
        userScopes.guest,
      );
      const session  = await sessions.getOne(
        {
          sessionCode : context.sessionCode,
          userCode    : identity.userCode,
          active      : true,
          erased      : false,
        },
        sessionScopes.guest,
      );
      if (
        !user ||
        !session ||
        session.expiration <= Date.now() / 1000 ||
        !user.workspaces?.includes(identity.workspace)
      )
        throw new ApplicationError(401, 'UNAUTHORIZED');
      const result    = await principals(
        {
          workspace : identity.workspace,
          userCodes : [identity.userCode],
        },
        source,
      );
      const principal = result.items.find(
        /** @param {Object} item Principal vigente. @returns {boolean} Exige el mismo actor y ámbito. */
        (item) => item.userCode === identity.userCode && item.workspace === identity.workspace,
      );
      if (!principal) throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
      const codes     = [...new Set(user.workspaces || [])].filter(
        /** @param {string} code Membresía del productor. @returns {boolean} Excluye el marcador global. */
        (code) => typeof code === 'string' && code && code !== 'allWorkspaces',
      );
      const available = [];
      for (let offset = 0; offset < codes.length; offset += 100) {
        const rows = await workspaces.getReferences(
          codes.slice(offset, offset + 100),
          'workspaceCode name',
          workspaceScopes.guest,
        );
        for (const row of rows)
          available.push({
            workspaceCode : row.workspaceCode,
            name          : row.name,
          });
      }
      available.sort(
        /** @param {Object} left Espacio. @param {Object} right Espacio. @returns {number} Orden estable independiente de la consulta física. */
        (left, right) => left.workspaceCode.localeCompare(right.workspaceCode),
      );
      if (
        !available.some(
          /** @param {Object} item Espacio todavía vigente. @returns {boolean} El contexto activo conserva acceso. */
          (item) => item.workspaceCode === identity.workspace,
        )
      )
        throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
      return {
        sessionCode : session.sessionCode,
        userCode    : identity.userCode,
        workspace   : identity.workspace,
        expiration  : session.expiration,
        groups      : [...new Set(user.groups || [])].sort(),
        policies    : [...new Set(principal.policies)].sort(),
        workspaces  : available,
      };
    },
  };
}
module.exports = { identityOwnAccessService };
