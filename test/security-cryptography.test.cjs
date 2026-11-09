/** @file Conformidad de los adaptadores de firma y contraseña compuestos por Security. */
'use strict';
const test = require('node:test');
const {
  verifyTokenSigner,
  verifyPasswordHasher,
} = require('./contracts/security-cryptography.contract.cjs');

/** @returns {void} Acredita el adaptador JWT utilizado por la composición, sin configuración global. */
function verifyProductionSigner() {
  verifyTokenSigner(require('jsonwebtoken'));
}
/** @returns {Promise<void>} Acredita el adaptador bcrypt con costo bajo exclusivo de integración. */
async function verifyProductionHasher() {
  await verifyPasswordHasher(require('bcrypt'));
}
test(
  'el firmante satisface el contrato de contexto, algoritmo, integridad y caducidad',
  verifyProductionSigner,
);
test(
  'el hash satisface el contrato de comparación, costo y tipos de entrada',
  verifyProductionHasher,
);
