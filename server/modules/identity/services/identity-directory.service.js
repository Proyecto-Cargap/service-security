/** @file Búsqueda y paginación del directorio canónico de identidades; preserva datos, permisos y errores públicos. */
'use strict';
/** Compone operaciones con sus colaboradores mínimos.
 * @param {Object} dependencies Lectores y capacidades abstractas requeridos.
 * @returns {Object} Casos de uso sin construir implementaciones técnicas.
 */
function identityDirectoryService({
  ApplicationError,
  active,
  codes,
  contactProfiles,
  current,
  readAll,
  userScopes,
  users,
}) {
  return {
    /**
     * Ejecuta directory dentro del flujo de identity.service.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string} source Valor de source utilizado por esta operación.
     * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async directory(data, source) {
      const actor = await current(source);
      if (data.workspace && !actor.workspaces.includes(data.workspace))
        throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
      if (actor.delegation) {
        if (data.workspace && data.workspace !== actor.workspace)
          throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
        data = {
          ...data,
          workspace : actor.workspace,
        };
      }
      const selected = data.codes === undefined ? undefined : codes(data.codes);
      const page     = Number(data.page ?? 1);
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        typeof (data.search ?? '') !== 'string' ||
        (data.search || '').length > 100
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      const result   = await readAll(
        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @param {number} page Índice de la página según el contrato de esta operación.
         * @param {number} perPage Cantidad máxima de elementos por página.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (page, perPage) =>
          users.getList(
            {
              ...active(selected !== undefined),
              ...(data.workspace ? { workspaces: data.workspace } : {}),
              ...(selected ? { userCode: { $in: selected } } : {}),
              $or : [
                { userType: { $nin: ['agent', 'external'] } },
                {
                  userType   : { $in: ['agent', 'external'] },
                  workspaces : actor.workspace,
                  state      : 'active',
                },
              ],
            },
            {
              user : 1,
              _id  : 1,
            },
            page,
            perPage,
            'userCode user contactCode userType agentCode state',
            userScopes.guest,
          ),
      );
      const profiles = await contactProfiles(result.listItem);
      const query    = (data.search || '').trim().toLocaleLowerCase();
      const items    = result.listItem
        .map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => ({
            userCode  : row.userCode,
            name      :
              profiles.get(row.contactCode || row.userCode)?.name ||
              (row.state === 'registered' ? 'Sin nombre' : row.user),
            email     :
              ['agent', 'external'].includes(row.userType) || row.state === 'registered'
                ? ''
                : row.user,
            actorType : row.userType === 'agent' ? 'agent' : 'human',
            ...(row.userType === 'agent' ? { agentCode: row.agentCode } : {}),
          }),
        )
        .filter(
          /**
           * Determina si el elemento cumple el criterio de selección.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => !query || `${row.name} ${row.email}`.toLocaleLowerCase().includes(query),
        );
      return {
        items      : selected ? items : items.slice((page - 1) * 20, page * 20),
        pagination : {
          page,
          perPage : 20,
          total   : items.length,
        },
      };
    },
  };
}
module.exports = { identityDirectoryService };
