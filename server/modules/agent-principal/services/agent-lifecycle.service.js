/** @file Casos de uso de agentes de la capacidad de ciclo de vida; conserva errores, autorizaciones y efectos vigentes. */
'use strict';
/** Compone una capacidad de agentes con colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por estas operaciones.
 * @returns {Object} Operaciones de aplicación sin construir SDK ni repositorios.
 */
function agentLifecycleService({
  ApplicationError,
  code,
  dto,
  messaging,
  origin,
  userScopes,
  users,
}) {
  return {
    /**
     * Revoca inmediatamente el principal sin borrar su identidad ni historial.
     * @param {Object} data Agente y espacio administrado.
     * @param {string} source Servicio que administra el agente.
     * @returns {Promise<Object>} Identidad suspendida.
     */
    async revoke(data, source) {
      origin(source);
      if (
        !code(data?.agentCode) ||
        !code(data?.workspace) ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 1
      )
        throw new ApplicationError(400, 'INVALID_AGENT_PRINCIPAL');
      const context = messaging.getContext();
      const user    = await users.getOne(
        {
          agentCode : data.agentCode,
          userType  : 'agent',
          erased    : false,
        },
        userScopes.guest,
      );
      const action  =
        data.operation === 'provisioning'
          ? data.revision === 1 && user?.userCreate === context.user?.userCode
            ? 'create'
            : 'update'
          : 'delete';
      const global  = context.policies?.includes(`intelligence.agent.${action}.global`);
      const local   =
        context.policies?.includes(`intelligence.agent.${action}.workspace`) &&
        data.workspace === context.workspace &&
        user?.workspace === context.workspace;
      if (
        !context.user?.userCode ||
        context.actorType === 'agent' ||
        context.user.userType === 'agent' ||
        (!global && !local)
      )
        throw new ApplicationError(403, 'AGENT_ADMIN_FORBIDDEN');
      if (!user) throw new ApplicationError(404, 'AGENT_PRINCIPAL_UNAVAILABLE');
      const saved = await users.update(
        {
          agentCode     : data.agentCode,
          agentRevision : data.revision,
          userType      : 'agent',
          erased        : false,
        },
        {
          $set : {
            state              : 'inactive',
            agentIdentityState : 'revoked',
            updateDate         : Date.now(),
          },
        },
        userScopes.guest,
      );
      if (!saved) throw new ApplicationError(409, 'AGENT_IDENTITY_CHANGED');
      return dto(saved);
    },
    /**
     * Activa únicamente la revisión aceptada por Intelligence; nunca resucita una revisión anterior.
     * @param {Object} data Identidad, espacio y revisión exacta.
     * @param {string} source Servicio de Intelligence.
     * @returns {Promise<Object>} Identidad activada por compare-and-swap.
     */
    async activate(data, source) {
      origin(source);
      if (
        !code(data?.agentCode) ||
        !code(data?.workspace) ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 1
      )
        throw new ApplicationError(400, 'INVALID_AGENT_PRINCIPAL');
      const context = messaging.getContext();
      const user    = await users.getOne(
        {
          agentCode : data.agentCode,
          userType  : 'agent',
          erased    : false,
        },
        userScopes.guest,
      );
      const action  =
        data.revision === 1 && user?.userCreate === context.user?.userCode ? 'create' : 'update';
      if (
        !context.user?.userCode ||
        context.actorType === 'agent' ||
        context.user.userType === 'agent' ||
        !(
          context.policies?.includes(`intelligence.agent.${action}.global`) ||
          (context.policies?.includes(`intelligence.agent.${action}.workspace`) &&
            user?.workspace === context.workspace &&
            data.workspace === context.workspace)
        )
      )
        throw new ApplicationError(403, 'AGENT_ADMIN_FORBIDDEN');
      if (data.confirmedRevision !== data.revision)
        throw new ApplicationError(409, 'AGENT_CONFIGURATION_UNAVAILABLE');
      const saved = await users.update(
        {
          agentCode          : data.agentCode,
          userType           : 'agent',
          erased             : false,
          agentRevision      : data.revision,
          agentIdentityState : 'ready',
        },
        {
          $set : {
            state      : 'active',
            updateDate : Date.now(),
          },
        },
        userScopes.guest,
      );
      if (!saved) throw new ApplicationError(409, 'AGENT_IDENTITY_CHANGED');
      return dto(saved);
    },
  };
}
module.exports = { agentLifecycleService };
