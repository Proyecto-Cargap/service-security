/** @file Publica vencimientos de sesiones atómicamente con su revisión, sin cerrar sesiones ni sondear pendientes. */
'use strict';
const { createAccessMutations } = require('../../../adapters/persistence/access-mutations');
/** @param {Object} dependencies Modelo de sesiones, outbox y reloj del productor. @returns {Object} Próximo vencimiento y transición cercada por la expiración vigente. */
function sessionExpirationRepository({ model, messaging, clock = Date.now }) {
  const mutations = createAccessMutations({
    model,
    messaging,
    resource  : 'session',
    codeField : 'sessionCode',
  });
  /** @returns {Object} Sólo sesiones activas cuyo vencimiento no tiene aún referencia durable. */
  function pending() {
    return {
      active     : true,
      erased     : { $ne: true },
      expiration : {
        $type : 'number',
        $gte  : 0,
      },
      $expr      : { $ne: ['$expiration', { $ifNull: ['$expirationNoticeFor', -1] }] },
    };
  }
  return {
    /** @returns {Promise<void>} Prepara únicamente el índice técnico, sin modificar datos históricos. */
    async prepare() {
      await model.collection.createIndex(
        {
          active     : 1,
          erased     : 1,
          expiration : 1,
        },
        { name: 'session_expiration_deadline' },
      );
    },
    /** @returns {Promise<number|undefined>} Una lectura al arrancar, ante cambios o al vencer un plazo conocido. */
    async nextAt() {
      const item = await model
        .findOne(pending())
        .select('expiration')
        .sort({
          expiration : 1,
          _id        : 1,
        })
        .lean();
      return item ? item.expiration * 1000 : undefined;
    },
    /** @returns {Promise<boolean>} Reclamación y publicación en la misma transacción, sin efectos externos que requieran un lease. */
    async publishDue() {
      const item = await model
        .findOne({ $and: [pending(), { expiration: { $lte: clock() / 1000 } }] })
        .select('_id expiration')
        .sort({
          expiration : 1,
          _id        : 1,
        })
        .lean();
      if (!item) return false;
      const changed = await mutations.update(
        {
          $and : [
            pending(),
            {
              _id        : item._id,
              expiration : item.expiration,
            },
          ],
        },
        { $set: { expirationNoticeFor: item.expiration } },
      );
      return Boolean(changed);
    },
  };
}
module.exports = { sessionExpirationRepository };
