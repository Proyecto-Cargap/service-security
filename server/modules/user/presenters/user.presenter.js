/** @file Proyección pública canónica de usuarios; excluye credenciales y metadatos privados en respuestas, eventos y notificaciones. */
'use strict';

const USER_FIELDS = Object.freeze([
  '_id',
  'revision',
  'workspace',
  'userCreate',
  'userAssigned',
  'workspaces',
  'userCode',
  'user',
  'contactCode',
  'code',
  'groups',
  'roleCode',
  'userType',
  'agentCode',
  'agentRevision',
  'agentConfigurationDigest',
  'agentIdentityState',
  'state',
  'numberAttemptsAccess',
  'lastAccessDate',
  'validity',
  'updateDate',
  'creationDate',
  'idTransaction',
  'erased',
]);

/**
 * Selecciona únicamente los campos públicos conocidos, sin invocar serializadores del registro.
 * Conserva campos ausentes de proyecciones parciales y copia las colecciones para no compartirlas.
 * @param {Object|null} record Registro de aplicación o documento durante la transición de persistencia.
 * @returns {Object|null} Usuario público independiente del consumidor; null conserva la ausencia.
 */
function userPresenter(record) {
  if (!record) return null;
  const result = {};
  for (const field of USER_FIELDS) {
    const value = record[field];
    if (value === undefined) continue;
    result[field] = field === '_id' ? String(value) : Array.isArray(value) ? [...value] : value;
  }
  return result;
}

/**
 * Presenta una página conservando la paginación pública y el rol canónico resuelto por Directory.
 * El rol ya procede de su contrato público; nunca se mezcla con el registro privado de usuario.
 * @param {Object} page Página de usuarios autorizados, con items y pagination.
 * @returns {Object} Página pública sin campos privados de usuarios ni propiedades adicionales de paginación.
 */
function userPagePresenter(page) {
  return {
    pagination : {
      total   : page.pagination.total,
      page    : page.pagination.page,
      perPage : page.pagination.perPage,
    },
    items      : page.items.map(
      /**
       * Proyecta el usuario y conserva el rol cuando la consulta lo ha resuelto.
       * @param {Object} item Usuario autorizado y su rol opcional.
       * @returns {Object} Usuario público con el enriquecimiento canónico existente.
       */
      (item) => ({
        ...userPresenter(item),
        ...(item.role === undefined ? {} : { role: item.role }),
      }),
    ),
  };
}

module.exports = {
  USER_FIELDS,
  userPresenter,
  userPagePresenter,
};
