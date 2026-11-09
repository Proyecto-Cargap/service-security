/** @file Casos de uso de agentes de la capacidad de aprovisionamiento; conserva errores, autorizaciones y efectos vigentes. */
'use strict';
/** Compone una capacidad de agentes con colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por estas operaciones.
 * @returns {Object} Operaciones de aplicación sin construir SDK ni repositorios.
 */
function agentProvisioningService({
  ApplicationError,
  code,
  codes,
  dto,
  groups,
  messaging,
  origin,
  tokenCryptography,
  userScopes,
  users,
  workspaceScopes,
  workspaces,
}) {
  return {
    /**
     * Crea o sincroniza la identidad vinculada sin contraseñas ni correo de activación.
     * @param {Object} data Identificador, nombre, perfiles y espacios explícitos.
     * @param {string} source Servicio que solicita el aprovisionamiento.
     * @returns {Promise<Object>} Identidad mínima del colaborador artificial.
     */
    async provision(data, source) {
      origin(source);
      if (
        !data ||
        !Number.isSafeInteger(data.revision) ||
        data.revision < 1 ||
        !code(data.agentCode) ||
        typeof data.name !== 'string' ||
        !data.name.trim() ||
        data.name.length > 200 ||
        !codes(data.groups) ||
        !codes(data.workspaces) ||
        !data.workspaces.length ||
        data.workspaces.includes('allWorkspaces') ||
        !data.workspaces.includes(data.workspace) ||
        (data.picture !== undefined &&
          (typeof data.picture !== 'string' || data.picture.length > 2000)) ||
        (data.state !== undefined && !['active', 'inactive'].includes(data.state)) ||
        (data.validity !== undefined &&
          (!Number.isFinite(data.validity) || data.validity <= Date.now()))
      )
        throw new ApplicationError(400, 'INVALID_AGENT_PRINCIPAL');
      const context   = messaging.getContext();
      const existing  = await users.getOne(
        {
          agentCode : data.agentCode,
          userType  : 'agent',
        },
        userScopes.guest,
      );
      const action    =
        data.revision === 1 && (!existing || existing.userCreate === context.user?.userCode)
          ? 'create'
          : 'update';
      const global    = context.policies?.includes(`intelligence.agent.${action}.global`);
      const workspace = context.policies?.includes(`intelligence.agent.${action}.workspace`);
      if (
        !context.user?.userCode ||
        context.user.userType === 'agent' ||
        context.actorType === 'agent' ||
        (!global &&
          !(
            workspace &&
            data.workspace === context.workspace &&
            data.workspaces.every(
              /**
               * Comprueba la condición requerida para cada elemento.
               * @param {*} value Valor de value utilizado por esta operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (value) => value === context.workspace,
            ) &&
            (!existing || existing.workspace === context.workspace)
          ))
      )
        throw new ApplicationError(403, 'AGENT_ADMIN_FORBIDDEN');
      for (const groupCode of data.groups) {
        const group = await groups.getOne({
          groupCode,
          erased : false,
        });
        if (
          !group ||
          (group.workspace !== 'allWorkspaces' && !data.workspaces.includes(group.workspace))
        )
          throw new ApplicationError(403, 'AGENT_PROFILE_UNAVAILABLE');
      }
      for (const workspaceCode of data.workspaces) {
        if (
          !(await workspaces.getOne(
            {
              workspaceCode,
              erased : false,
            },
            workspaceScopes.guest,
          ))
        )
          throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
      }
      if (existing?.erased) throw new ApplicationError(409, 'AGENT_IDENTITY_REMOVED');
      const digest = tokenCryptography.fingerprint(
        JSON.stringify([
          data.name.trim(),
          data.picture || '',
          [...data.groups].sort(),
          [...data.workspaces].sort(),
          data.workspace,
          data.validity || null,
        ]),
      );
      if (
        existing &&
        (existing.agentRevision > data.revision ||
          (existing.agentRevision === data.revision &&
            existing.agentConfigurationDigest !== digest))
      )
        throw new ApplicationError(409, 'AGENT_IDENTITY_CHANGED');
      if (existing?.agentRevision === data.revision && existing.agentIdentityState === 'revoked')
        throw new ApplicationError(409, 'AGENT_IDENTITY_CHANGED');
      if (existing?.agentRevision === data.revision && existing.agentIdentityState === 'ready')
        return dto(existing);
      if (existing) {
        const reserved = await users.update(
          {
            userCode : existing.userCode,
            $or      : [
              { agentRevision: existing.agentRevision ?? 0 },
              { agentRevision: { $exists: false } },
            ],
          },
          {
            $set : {
              state                    : 'inactive',
              agentRevision            : data.revision,
              agentConfigurationDigest : digest,
              agentIdentityState       : 'pending',
            },
          },
          userScopes.guest,
        );
        if (!reserved) throw new ApplicationError(409, 'AGENT_IDENTITY_CHANGED');
      }
      const profile = await messaging.request('service-directory', 'agent-contact-provision', {
        revision   : data.revision,
        agentCode  : data.agentCode,
        name       : data.name.trim(),
        picture    : data.picture,
        workspace  : data.workspace,
        workspaces : data.workspaces,
      });
      if (
        profile?.statusCode !== 200 ||
        !code(profile.data?.contactCode) ||
        profile.data?.userCode !== profile.data.contactCode
      )
        throw new ApplicationError(503, 'AGENT_CONTACT_UNAVAILABLE');
      const identity = {
        userCode                 : profile.data.userCode,
        contactCode              : profile.data.contactCode,
        agentCode                : data.agentCode,
        agentRevision            : data.revision,
        agentConfigurationDigest : digest,
        agentIdentityState       : 'ready',
        userType                 : 'agent',
        user                     : `agent:${data.agentCode}`,
        groups                   : [...data.groups],
        workspaces               : [...data.workspaces],
        workspace                : data.workspace,
        state                    : 'inactive',
        validity                 : data.validity ?? existing?.validity ?? Date.now() + 365 * 86400000,
        userCreate               : existing?.userCreate || context.user.userCode,
        userAssigned             : existing?.userAssigned || '',
        password                 : '',
        activationToken          : '',
        erased                   : false,
        idTransaction            : context.idTransaction || '',
        updateDate               : Date.now(),
      };
      if (existing && existing.userCode !== identity.userCode)
        throw new ApplicationError(409, 'AGENT_CONTACT_MISMATCH');
      if (existing) {
        const saved = await users.update(
          {
            userCode           : existing.userCode,
            agentCode          : data.agentCode,
            agentRevision      : data.revision,
            agentIdentityState : 'pending',
            userType           : 'agent',
            erased             : false,
          },
          { $set: identity },
          userScopes.guest,
        );
        if (!saved) {
          const accepted = await users.getOne(
            {
              userCode                 : existing.userCode,
              agentRevision            : data.revision,
              agentConfigurationDigest : digest,
              agentIdentityState       : 'ready',
              erased                   : false,
            },
            userScopes.guest,
          );
          if (!accepted) throw new ApplicationError(409, 'AGENT_IDENTITY_CHANGED');
          return dto(accepted);
        }
        return dto(saved);
      }
      try {
        return dto(await users.create(identity, userScopes.guest));
      } catch (error) {
        if (error.code !== 11000) throw error;
        const saved = await users.getOne(
          {
            agentCode : data.agentCode,
            userType  : 'agent',
            erased    : false,
          },
          userScopes.guest,
        );
        if (
          !saved ||
          saved.userCode !== identity.userCode ||
          saved.agentRevision !== data.revision ||
          saved.agentConfigurationDigest !== digest
        )
          throw new ApplicationError(409, 'AGENT_IDENTITY_CONFLICT');
        return dto(saved);
      }
    },
  };
}
module.exports = { agentProvisioningService };
