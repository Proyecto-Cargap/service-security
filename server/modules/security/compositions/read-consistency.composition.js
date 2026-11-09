/** @file Delimita las consultas canónicas que comparten una instantánea local de Security. */
'use strict';
const reads = new Set([
  'user-get-list',
  'user-get-one',
  'user-directory-get-list',
  'user-profile-get-list',
  'user-profile-get-one',
  'session-get-list',
  'session-get-one',
  'session-restore',
  'session-own-profile-get',
  'session-own-access-get',
  'group-get-list',
  'group-get-one',
  'policy-get-list',
  'policy-get-index',
  'policy-get-one',
  'workspaces-get-list',
  'workspaces-get-one',
  'workspace-users-get-list',
  'settings-get-list',
  'settings-get-one',
  'oauth-grant-get-list',
]);
/** @param {Object[]} entries Capacidades canónicas. @param {Function} snapshot Unidad de lectura. @returns {Object[]} Mantiene DTO, permisos y metadatos de cada capacidad. */
function consistentReads(entries, snapshot) {
  if (typeof snapshot !== 'function') throw new TypeError('SECURITY_SNAPSHOT_REQUIRED');
  return entries.map(
    /** @param {Object} entry Acción registrada. @returns {Object} Las acciones de escritura conservan su transacción propia. */
    (entry) =>
      !reads.has(entry.name)
        ? entry
        : {
            ...entry,
            /** @param {Object} message Solicitud acreditada. @returns {Promise<Object>} Lectura estable; nunca limpia ni actualiza registros. */
            handler(message) {
              return snapshot(
                /** @returns {Promise<Object>} Resultado completo del propietario. */
                () => entry.handler(message),
              );
            },
          },
  );
}
module.exports = { consistentReads };
