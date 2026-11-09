/** @file Aprovisionamiento recuperable de personas externas y sesiones internas breves sin credenciales interactivas. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
const { externalPolicies } = require('../policies/external-access.policy');
/** Compone una identidad ligada al contacto y conversación reservados por Connect.
 * @param {Object} dependencies Repositorios, lectura de permisos, reloj y huella inyectados.
 * @returns {Object} Alta idempotente y emisión interna, exclusivas del Gateway.
 */
function externalPrincipalService({
  users,
  sessions,
  workspaces,
  groups,
  principals,
  userScope,
  sessionScope,
  workspaceScope,
  groupScope,
  now,
  fingerprint,
}) {
  /** Comprueba el origen técnico antes de leer identidad o generar sesión.
   * @param {string} source Origen del sobre autenticado.
   * @returns {void} Rechaza cualquier consumidor público o distinto del Gateway.
   */
  function origin(source) {
    if (source !== 'service-apigateway') throw new ApplicationError(403, 'FORBIDDEN');
  }
  /** Revalida administrador y workspace en cada operación diferida.
   * @param {Object} data Vínculo obtenido por Gateway desde Connect.
   * @returns {Promise<void>} Autoridad vigente; la revocación falla cerrada.
   */
  async function authority(data) {
    const owner = await users.getOne(
      {
        userCode : data.ownerUserCode,
        erased   : false,
        state    : 'active',
        validity : { $gt: now() },
      },
      userScope,
    );
    if (!owner || ['external', 'agent'].includes(owner.userType))
      throw new ApplicationError(403, 'META_OWNER_UNAVAILABLE');
    const result = await principals(
      {
        workspace : data.workspaceCode,
        userCodes : [data.ownerUserCode],
      },
      'service-apigateway',
    );
    if (!result.items[0]?.policies.includes('connect.meta.update.global'))
      throw new ApplicationError(403, 'META_OWNER_UNAVAILABLE');
    if (
      !(await workspaces.getOne(
        {
          workspaceCode : data.workspaceCode,
          erased        : false,
        },
        workspaceScope,
      ))
    )
      throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
  }
  return {
    /** Crea una cuenta sin contraseña para un contacto ya confirmado; reintentar conserva identidad.
     * @param {Object} data Contacto, conversación, workspace y perfiles del vínculo interno.
     * @param {string} source Servicio autenticado.
     * @returns {Promise<Object>} Sólo identificadores canónicos, nunca un token.
     */
    async provision(data, source) {
      origin(source);
      await authority(data);
      for (const groupCode of data.groups) {
        const group = await groups.getOne(
          {
            groupCode,
            erased : false,
          },
          groupScope,
        );
        if (!group || ![data.workspaceCode, 'allWorkspaces'].includes(group.workspace))
          throw new ApplicationError(403, 'EXTERNAL_PROFILE_UNAVAILABLE');
      }
      const filter = { userCode: data.contactCode };
      let user     = await users.getOne(filter, userScope);
      if (
        user &&
        (user.userType !== 'external' ||
          user.externalConversationCode !== data.conversationCode ||
          user.workspace !== data.workspaceCode ||
          user.erased)
      )
        throw new ApplicationError(409, 'EXTERNAL_IDENTITY_CONFLICT');
      if (user && user.state !== 'active')
        throw new ApplicationError(403, 'EXTERNAL_IDENTITY_REVOKED');
      const identity = {
        userCode                 : data.contactCode,
        contactCode              : data.contactCode,
        user                     : `external:${data.contactCode}`,
        userType                 : 'external',
        externalConversationCode : data.conversationCode,
        workspace                : data.workspaceCode,
        workspaces               : [data.workspaceCode],
        groups                   : [...data.groups],
        state                    : 'active',
        password                 : '',
        activationToken          : '',
        validity                 : now() + 365 * 86400000,
        userCreate               : data.ownerUserCode,
        userAssigned             : '',
        erased                   : false,
      };
      if (!user) {
        try {
          user = await users.create(identity, userScope);
        } catch (error) {
          if (error.code !== 11000) throw error;
          user = await users.getOne(filter, userScope);
          if (
            !user ||
            user.userType !== 'external' ||
            user.externalConversationCode !== data.conversationCode ||
            user.workspace !== data.workspaceCode ||
            user.erased
          )
            throw new ApplicationError(409, 'EXTERNAL_IDENTITY_CONFLICT');
        }
      } else {
        user = await users.update(
          {
            ...filter,
            userType : 'external',
            erased   : false,
            state    : 'active',
          },
          { $set: { groups: identity.groups } },
          userScope,
        );
        if (!user) throw new ApplicationError(403, 'EXTERNAL_IDENTITY_REVOKED');
      }
      return {
        userCode    : user.userCode,
        contactCode : user.contactCode,
      };
    },
    /** Emite una sesión sólo de transporte interno; su token almacenado no es JWT ni se devuelve.
     * @param {Object} data Identificadores del vínculo, sin permisos ni actor del navegador.
     * @param {string} source Gateway autenticado.
     * @returns {Promise<Object>} Contexto interno acotado y expiración en segundos.
     */
    async resolve(data, source) {
      origin(source);
      await authority(data);
      const user = await users.getOne(
        {
          userCode                 : data.contactCode,
          userType                 : 'external',
          externalConversationCode : data.conversationCode,
          workspace                : data.workspaceCode,
          workspaces               : data.workspaceCode,
          erased                   : false,
          state                    : 'active',
          validity                 : { $gt: now() },
        },
        userScope,
      );
      if (!user) throw new ApplicationError(403, 'EXTERNAL_IDENTITY_UNAVAILABLE');
      if (
        JSON.stringify([...(user.groups || [])].sort()) !== JSON.stringify([...data.groups].sort())
      ) {
        for (const groupCode of data.groups) {
          const group = await groups.getOne(
            {
              groupCode,
              erased : false,
            },
            groupScope,
          );
          if (!group || ![data.workspaceCode, 'allWorkspaces'].includes(group.workspace))
            throw new ApplicationError(403, 'EXTERNAL_PROFILE_UNAVAILABLE');
        }
        const changed = await users.update(
          {
            userCode : user.userCode,
            userType : 'external',
            state    : 'active',
            erased   : false,
          },
          { $set: { groups: [...data.groups] } },
          userScope,
        );
        if (!changed) throw new ApplicationError(403, 'EXTERNAL_IDENTITY_REVOKED');
      }
      const effective   = await principals(
        {
          workspace : data.workspaceCode,
          userCodes : [user.userCode],
        },
        source,
      );
      const policies    = externalPolicies(effective.items[0]?.policies || []);
      const expiration  = (Math.floor(now() / 240000) + 1) * 240 + 60;
      const sessionCode = `external:${fingerprint(JSON.stringify([user.userCode, data.conversationCode, expiration, [...policies].sort()]))}`;
      const input       = {
        sessionCode,
        token                    : sessionCode,
        userCode                 : user.userCode,
        workspace                : data.workspaceCode,
        activeWorkspace          : data.workspaceCode,
        workspaces               : [data.workspaceCode],
        policies,
        active                   : true,
        expiration,
        userCreate               : user.userCode,
        userAssigned             : '',
        externalConversationCode : data.conversationCode,
        externalExpiresAt        : new Date(expiration * 1000),
      };
      let session       = await sessions.getOne({ token: sessionCode }, sessionScope);
      if (!session) {
        try {
          session = await sessions.create(input, sessionScope);
        } catch (error) {
          if (error.code !== 11000) throw error;
          session = await sessions.getOne({ token: sessionCode }, sessionScope);
        }
      }
      if (!session?.active) throw new ApplicationError(401, 'EXTERNAL_SESSION_REVOKED');
      return {
        context : {
          user                     : {
            userCode : user.userCode,
            userType : 'external',
          },
          workspace                : data.workspaceCode,
          policies,
          sessionCode,
          externalConversationCode : data.conversationCode,
        },
        expiration,
      };
    },
  };
}
module.exports = { externalPrincipalService };
