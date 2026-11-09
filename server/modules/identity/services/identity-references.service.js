/** @file Referencias públicas de identidad: una lectura acotada de usuarios y perfiles bajo autorización vigente. */
'use strict';

/** @param {Object} dependencies Identidad, lectores canónicos y límites de códigos. @returns {Object} Referencias públicas independientes del consumidor. */
function identityReferencesService({ codes, current, users, userScopes, contactProfiles }) {
  return {
    /** @param {Object} data Códigos explícitos, como máximo cien. @param {string} source Origen acreditado. @returns {Promise<Object>} Nombre vigente, correo actualmente visible y revisión de imagen. */
    async references(data, source) {
      const actor    = await current(source);
      const selected = codes(data.codes);
      if (!selected.length) return { items: [] };
      const references = await users.getReferences(
        selected,
        'userCode contactCode user userType workspaces state validity',
        userScopes.guest,
      );
      const rows       = actor.delegation
        ? references.filter(
            /** @param {Object} row Identidad. @returns {boolean} Respeta el destino delegado. */
            (row) => row.workspaces?.includes(actor.workspace),
          )
        : references;
      const profiles   = await contactProfiles(rows);
      const now        = Date.now();
      return {
        items : rows.flatMap(
          /** @param {Object} row Identidad no eliminada. @returns {Object[]} Una proyección explícita, sin recuperar correos de cuentas retiradas. */
          (row) => {
            const profile          = profiles.get(row.contactCode || row.userCode);
            const special          = ['agent', 'external'].includes(row.userType);
            const directoryVisible =
              ['active', 'registered'].includes(row.state) &&
              row.validity > now &&
              (!special || (row.state === 'active' && row.workspaces?.includes(actor.workspace)));
            if (!profile && !directoryVisible) return [];
            return [
              {
                userCode        : row.userCode,
                name            :
                  profile?.name ||
                  (directoryVisible
                    ? row.state === 'registered'
                      ? 'Sin nombre'
                      : row.user
                    : 'Usuario no disponible'),
                email           : directoryVisible && !special && row.state !== 'registered' ? row.user : '',
                pictureRevision : profile?.pictureRevision || 0,
              },
            ];
          },
        ),
      };
    },
  };
}
module.exports = { identityReferencesService };
