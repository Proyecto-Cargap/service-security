/** @file Unidad de lectura de Security: filas, totales y referencias locales de una misma instantánea MongoDB. */
'use strict';
/** @param {Object} dependencies Mongoose y conexión propietaria. @returns {Function} Ejecuta una consulta completa, sin efectos de negocio. */
function readSnapshot({ mongoose, connection = mongoose.connection }) {
  mongoose.set('transactionAsyncLocalStorage', true);
  /** @param {Function} work Lectura canónica ya autorizada. @returns {Promise<Object>} El productor emitirá el recibo sobre este resultado exacto. */
  return function snapshot(work) {
    return connection.transaction(work, { readConcern: { level: 'snapshot' } });
  };
}
module.exports = { readSnapshot };
