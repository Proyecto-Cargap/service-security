/** @file Capacidades criptográficas de tokens y huellas; encapsula crypto fuera de los casos de uso. */
'use strict';
const { createHash, randomUUID } = require('node:crypto');

/**
 * Genera un identificador impredecible para una autorización de un solo uso.
 * @returns {string} UUID nuevo; no persiste ni publica el valor.
 */
function identifier() {
  return randomUUID();
}

/**
 * Obtiene una huella determinista para comparar autorizaciones o configuraciones idempotentes.
 * @param {string} value Texto que se resume sin conservarlo ni registrarlo.
 * @returns {string} SHA-256 hexadecimal en minúsculas; propaga entradas no admitidas por crypto.
 */
function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

module.exports = Object.freeze({
  identifier,
  fingerprint,
});
