/** @file Principales vigentes por workspace para efectos diferidos: membresía y permisos efectivos sin sesión ni credenciales. */
'use strict';
const { externalPolicies } = require('../../external-principal/policies/external-access.policy');

/** Compone lectura canónica de autorización con repositorios ya construidos.
 * @param {Object} dependencies Lectores, políticas locales y paginación completa.
 * @returns {Object} Consulta interna de principales explícitos.
 */
function identityPrincipalsService({
  ApplicationError,
  origin,
  codes,
  active,
  users,
  groups,
  policies,
  workspaces,
  userScopes,
  groupScopes,
  policyScopes,
  workspaceScopes,
}) {
  const service = {
    /** @param {Object} data Usuarios explícitos. @param {string} source Origen acreditado. @returns {Promise<Object>} Principales por membresía, sin unir políticas entre espacios. */
    async userPrincipals(data, source) {
      origin(source);
      const items = [];
      for (const userCode of codes(data.userCodes)) {
        const user = await users.getOne(
          {
            ...active(),
            userCode,
            userType : { $nin: ['agent', 'external'] },
          },
          userScopes.guest,
        );
        if (!user) continue;
        for (const workspace of new Set(user.workspaces || [])) {
          if (workspace === 'allWorkspaces') continue;
          const result = await service.principals(
            {
              workspace,
              userCodes : [userCode],
            },
            source,
          );
          items.push(...result.items);
        }
      }
      return { items };
    },
    /** @param {Object} data Usuarios explícitos. @param {string} source Origen de entrega. @returns {Promise<Object>} Direcciones activas para envío privado, nunca perfiles públicos. */
    async deliveryAddresses(data, source) {
      if (!['service-platform', 'service-connect'].includes(source))
        throw new ApplicationError(403, 'FORBIDDEN');
      const items = [];
      for (const userCode of codes(data.userCodes)) {
        const user = await users.getOne(
          {
            ...active(),
            userCode,
            userType : { $nin: ['agent', 'external'] },
          },
          userScopes.guest,
        );
        if (user?.user)
          items.push({
            userCode,
            email : user.user,
          });
      }
      return { items };
    },
    /** Resuelve permisos actuales de hasta cien miembros, omitiendo únicamente identidades realmente ausentes.
     * @param {Object} data Workspace y códigos explícitos de usuario.
     * @param {string} source Servicio acreditado por el transporte.
     * @returns {Promise<Object>} Principales separados, sin unión de permisos ni credenciales.
     */
    async principals(data, source) {
      origin(source);
      if (
        !data.workspace ||
        data.workspace === 'allWorkspaces' ||
        !Array.isArray(data.userCodes) ||
        !data.userCodes.length
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      const selected = codes(data.userCodes),
        items        = [];
      if (
        !(await workspaces.getOne(
          {
            workspaceCode : data.workspace,
            erased        : false,
          },
          workspaceScopes.guest,
        ))
      )
        return { items };
      for (const userCode of selected) {
        const user = await users.getOne(
          {
            ...active(),
            userCode,
            workspaces : data.workspace,
          },
          userScopes.guest,
        );
        if (!user) continue;
        const memberships = await groups.readAccess(
          {
            groupCode : { $in: user.groups || [] },
            erased    : false,
            workspace : { $in: [data.workspace, 'allWorkspaces'] },
          },
          groupScopes.guest,
        );
        const policyCodes = new Set();
        for (const group of memberships)
          for (const code of group.policies || []) policyCodes.add(code);
        const effective   = await policies.readAccess(
          {
            policyCode : { $in: [...policyCodes] },
            erased     : false,
            active     : true,
            workspace  : { $in: [data.workspace, 'allWorkspaces'] },
          },
          policyScopes.guest,
        );
        const identifiers = new Set();
        for (const policy of effective) identifiers.add(policy.identifier);
        items.push({
          userCode,
          workspace : data.workspace,
          policies  :
            user.userType === 'external' ? externalPolicies([...identifiers]) : [...identifiers],
        });
      }
      return { items };
    },
  };
  return service;
}
module.exports = { identityPrincipalsService };
