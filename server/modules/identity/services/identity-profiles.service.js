/** @file Consultas canónicas de perfiles de usuarios; preserva datos, permisos y errores públicos. */
'use strict';
/** Compone operaciones con sus colaboradores mínimos.
 * @param {Object} dependencies Lectores y capacidades abstractas requeridos.
 * @returns {Object} Casos de uso sin construir implementaciones técnicas.
 */
function identityProfilesService({
  ApplicationError,
  codes,
  contactProfiles,
  current,
  messaging,
  userScopes,
  users,
}) {
  return {
    /**
     * Ejecuta profiles dentro del flujo de identity.service.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string} source Valor de source utilizado por esta operación.
     * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async profiles(data, source) {
      const actor    = await current(source);
      const selected = codes(data.codes);
      if (!selected.length) return { items: [] };
      const references = await users.getReferences(
        selected,
        'userCode contactCode workspaces',
        userScopes.guest,
      );
      const rows       = actor.delegation
        ? references.filter(
            /** @param {Object} row Perfil. @returns {boolean} Miembro del destino de la operación delegada. */
            (row) => row.workspaces?.includes(actor.workspace),
          )
        : references;
      const profiles   = await contactProfiles(rows);
      return {
        items : rows.flatMap(
          /**
           * Proyecta y reúne los elementos en una sola colección.
           * @param {*} row Valor de row utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (row) => {
            const profile = profiles.get(row.contactCode || row.userCode);
            return profile
              ? [
                  {
                    userCode        : row.userCode,
                    name            : profile.name,
                    hasPicture      : profile.hasPicture === true,
                    pictureRevision : profile.pictureRevision || 0,
                  },
                ]
              : [];
          },
        ),
      };
    },
    /**
     * Ejecuta profile dentro del flujo de identity.service.
     * @param {Object} data Datos de entrada de la operación.
     * @param {string} source Valor de source utilizado por esta operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async profile(data, source) {
      const actor = await current(source);
      codes([data.userCode]);
      const user = await users.getOne(
        {
          userCode : data.userCode,
          ...(actor.delegation ? { workspaces: actor.workspace } : {}),
          erased   : false,
        },
        userScopes.guest,
      );
      if (!user) return null;
      const response = await messaging.request('service-directory', 'contact-profile-get-one', {
        contactCode : user.contactCode || user.userCode,
      });
      if (response?.statusCode !== 200)
        throw new ApplicationError(
          response?.statusCode || 503,
          response?.descriptionCode || 'IDENTITY_DIRECTORY_UNAVAILABLE',
        );
      await current(source);
      if (response.data === null) return null;
      const profile = { ...response.data };
      // Esta capacidad conserva su proyección; la revisión de imagen pertenece al perfil propio.
      delete profile.revision;
      return profile;
    },
  };
}
module.exports = { identityProfilesService };
