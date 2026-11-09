/** @file Consulta de membresías vigentes de un espacio de trabajo; preserva datos, permisos y errores públicos. */
'use strict';
/** Compone operaciones con sus colaboradores mínimos.
 * @param {Object} dependencies Lectores y capacidades abstractas requeridos.
 * @returns {Object} Casos de uso sin construir implementaciones técnicas.
 */
function identityMembershipService({
  ApplicationError,
  active,
  codes,
  origin,
  current,
  messaging,
  userScopes,
  users,
  workspaceScopes,
  workspaces,
}) {
  return {
    /**
     * Ejecuta workspaceUsers dentro del flujo de identity.service.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string} source Valor de source utilizado por esta operación.
     * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async workspaceUsers(data, source) {
      origin(source);
      if (messaging?.getContext().delegation) {
        const actor = await current(source);
        if (data.workspace !== actor.workspace)
          throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
      }
      if (
        typeof data.workspace !== 'string' ||
        !data.workspace ||
        data.workspace === 'allWorkspaces'
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      const selected = data.userCodes === undefined ? undefined : codes(data.userCodes);
      const page = Number(data.page ?? 1),
        perPage  = Number(data.perPage ?? 100);
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(perPage) ||
        perPage < 1 ||
        perPage > 100
      )
        throw new ApplicationError(400, 'INVALID_PAGINATION');
      const workspace = await workspaces.getOne(
        {
          workspaceCode : data.workspace,
          erased        : false,
        },
        workspaceScopes.guest,
      );
      if (!workspace)
        return {
          items      : [],
          pagination : {
            page,
            perPage,
            total : 0,
          },
        };
      const result = await users.getList(
        {
          ...active(),
          workspaces : data.workspace,
          ...(selected ? { userCode: { $in: selected } } : {}),
        },
        { userCode: 1 },
        page - 1,
        perPage,
        'userCode',
        userScopes.guest,
      );
      return {
        items      : result.listItem.map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => ({ userCode: row.userCode }),
        ),
        pagination : {
          page,
          perPage,
          total : result.totalCount,
        },
      };
    },
  };
}
module.exports = { identityMembershipService };
