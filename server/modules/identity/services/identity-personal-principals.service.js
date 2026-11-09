/** @file Resuelve permisos owner actuales de personas para efectos diferidos independientes del workspace activo. */
'use strict';
/** @param {Object} dependencies Lectores de identidad, origen y paginación. @returns {Object} Consulta interna sin sesión, correo ni credenciales. */
function identityPersonalPrincipalsService({
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
  readAll,
}) {
  return {
    /** @param {Object} data Códigos explícitos, hasta cien personas. @param {string} source Servicio acreditado. @returns {Promise<Object>} Capacidades owner en sus membresías actuales, sin ámbitos administrativos. */
    async personalPrincipals(data, source) {
      origin(source);
      const items = [];
      for (const userCode of codes(data.userCodes)) {
        const user = await users.getOne(
          {
            ...active(),
            userCode,
          },
          userScopes.guest,
        );
        if (!user || user.userType === 'external') continue;
        const spaces        = await readAll(
          /** @param {number} page Página interna. @param {number} perPage Límite del lote. @returns {Promise<Object>} Membresías cuyo workspace sigue existiendo. */
          (page, perPage) =>
            workspaces.getList(
              {
                workspaceCode : { $in: user.workspaces || [] },
                erased        : false,
              },
              { _id: 1 },
              page,
              perPage,
              'workspaceCode',
              workspaceScopes.guest,
            ),
        );
        const allowedSpaces = ['allWorkspaces'];
        for (const space of spaces.listItem) allowedSpaces.push(space.workspaceCode);
        const memberships = await groups.readAccess(
          {
            groupCode : { $in: user.groups || [] },
            erased    : false,
            workspace : { $in: allowedSpaces },
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
            workspace  : { $in: allowedSpaces },
            identifier : { $regex: /\.owner$/ },
          },
          policyScopes.guest,
        );
        const identifiers = new Set();
        for (const policy of effective)
          if (policy.identifier.endsWith('.owner')) identifiers.add(policy.identifier);
        items.push({
          userCode,
          policies : [...identifiers],
        });
      }
      return { items };
    },
  };
}
module.exports = { identityPersonalPrincipalsService };
