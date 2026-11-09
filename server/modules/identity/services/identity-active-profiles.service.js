/** @file Elegibilidad global de contactos con cuenta activa; consulta interna sin credenciales ni permisos de otros dominios. */
'use strict';
/** @param {Object} dependencies Lectores canónicos, origen y proyección mínima. @returns {Object} Consulta independiente del workspace y sin resolución OAuth recursiva. */
function identityActiveProfilesService({
  origin,
  codes,
  active,
  users,
  userScopes,
  readAll,
  contactProfiles,
  ApplicationError,
}) {
  return {
    /** @param {Object} data Códigos o búsqueda paginada. @param {string} source Servicio acreditado. @returns {Promise<Object>} Identidades activas con nombres públicos; ningún correo, grupo o secreto. */
    async activeProfiles(data, source) {
      origin(source);
      const selected = data.userCodes === undefined ? undefined : codes(data.userCodes);
      const contacts = data.contactCodes === undefined ? undefined : codes(data.contactCodes);
      const page = data.page ?? 1,
        perPage  = data.perPage ?? 100;
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(perPage) ||
        perPage < 1 ||
        perPage > 100 ||
        typeof (data.search ?? '') !== 'string' ||
        (data.includeUnconfirmed !== undefined && typeof data.includeUnconfirmed !== 'boolean')
      )
        throw new ApplicationError(400, 'INVALID_PAGINATION');
      const rows     = await readAll(
        /** @param {number} offset Página interna. @param {number} limit Lote. @returns {Promise<Object>} Conjunto ordenado sin depender de membresías de workspace. */
        (offset, limit) =>
          users.getList(
            {
              ...active(data.includeUnconfirmed === true),
              userType : { $nin: ['agent', 'external'] },
              ...(contacts ? { contactCode: { $in: contacts } } : {}),
              ...(selected ? { userCode: { $in: selected } } : {}),
            },
            { userCode: 1 },
            offset,
            limit,
            'userCode contactCode',
            userScopes.guest,
          ),
      );
      const profiles = await contactProfiles(rows.listItem);
      const query    = (data.search || '').trim().toLocaleLowerCase();
      const matches  = [];
      for (const user of rows.listItem) {
        const contactCode = user.contactCode || user.userCode;
        const profile     = profiles.get(contactCode);
        if (!profile) continue;
        const name = profile.name || '';
        if (query && !name.toLocaleLowerCase().includes(query)) continue;
        matches.push({
          userCode        : user.userCode,
          contactCode,
          name,
          hasPicture      : profile.hasPicture === true,
          pictureRevision : profile.pictureRevision || 0,
        });
      }
      return {
        items      : matches.slice((page - 1) * perPage, page * perPage),
        pagination : {
          page,
          perPage,
          total : matches.length,
        },
      };
    },
  };
}
module.exports = { identityActiveProfilesService };
