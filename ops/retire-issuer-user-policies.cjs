/** @file Retira permisos owner/assigned de emisores y sus referencias de grupos sin otorgar permisos sustitutos. */
'use strict';
const { MongoClient } = require('mongoose').mongo;
const identifiers     = ['view', 'create', 'update'].flatMap(
  /** @param {string} action Acción. @returns {string[]} Identificadores que dejan de autorizar emisores. */
  (action) =>
    ['owner', 'assigned'].map(
      /** @param {string} scope Ámbito retirado. @returns {string} Permiso exacto. */
      (scope) => `billing.issuer.${action}.${scope}`,
    ),
);
/** @param {Object} db Base Security explícita. @param {Object} client Cliente abierto. @param {boolean} apply Habilita la transición. @returns {Promise<Object>} Diagnóstico o retirada transaccional e idempotente sin ampliar derechos. */
async function retire(db, client, apply = false) {
  const session = client.startSession();
  try {
    return await session.withTransaction(
      /** @returns {Promise<Object>} Retira referencias y desactiva las políticas en el mismo snapshot. */
      async () => {
        const policies = await db
          .collection('SECURITY_POLICY')
          .find({ identifier: { $in: identifiers } }, { session })
          .toArray();
        const codes    = policies.map(
          /** @param {Object} policy Política persistida. @returns {string} Identidad referenciada por grupos. */
          (policy) => policy.policyCode,
        );
        const groups   = await db
          .collection('SECURITY_GROUP')
          .countDocuments({ policies: { $in: codes } }, { session });
        if (apply && codes.length) {
          await db
            .collection('SECURITY_GROUP')
            .updateMany(
              { policies: { $in: codes } },
              { $pull: { policies: { $in: codes } } },
              { session },
            );
          await db.collection('SECURITY_POLICY').updateMany(
            { identifier: { $in: identifiers } },
            {
              $set : {
                active : false,
                erased : true,
              },
            },
            { session },
          );
        }
        return {
          applied  : apply,
          policies : policies.length,
          groups,
        };
      },
    );
  } finally {
    await session.endSession();
  }
}
/** @returns {Promise<void>} Usa una URI explícita; sin --apply sólo informa cantidades. */
async function main() {
  if (!process.env.SECURITY_MIGRATION_URI) throw new Error('SECURITY_MIGRATION_URI_REQUIRED');
  const client = new MongoClient(process.env.SECURITY_MIGRATION_URI);
  try {
    await client.connect();
    console.log(
      JSON.stringify(await retire(client.db(), client, process.argv.includes('--apply'))),
    );
  } finally {
    await client.close();
  }
}
if (require.main === module)
  main().catch(
    /** @returns {void} Omite detalles de conexión y datos privados al señalar el fallo. */
    () => {
      console.error('No se completó la retirada de políticas de emisores.');
      process.exitCode = 1;
    },
  );
module.exports = { retire };
