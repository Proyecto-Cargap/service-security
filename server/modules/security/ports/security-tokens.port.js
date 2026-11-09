/** @file Contratos mínimos de criptografía y configuración consumidos por los flujos de autorización de Security. */
'use strict';
const { requireCapability } = require('./security-dependencies.port');

/**
 * @typedef {Object} TokenSigner
 * @property {function(Object, string, Object):string} sign Firma HS256 con issuer, audience y expiresIn explícitos; conserva purpose y exp. Es síncrono y no hace llamadas de red. Una configuración inválida lanza un error antes de producir efectos externos.
 * @property {function(string, string, Object):Object} verify Verifica firma, algoritmo permitido, emisor, audiencia y caducidad; devuelve las afirmaciones simples únicamente si son válidas. Firma, emisor, audiencia o caducidad inválidos lanzan un error. No autoriza acceso a datos ni sustituye la revalidación de permisos.
 * @property {function(string):Object|null} decode Lee afirmaciones de una credencial propia recién emitida; no acredita autenticidad. Devuelve null si la codificación no es reconocible.
 */

/**
 * @typedef {Object} PasswordHasher
 * @property {function(string, number):Promise<string>} hash Obtiene un hash bcrypt con el costo explícito; nunca devuelve ni conserva la contraseña recibida como resultado.
 * @property {function(string, string):Promise<boolean>} compare Resuelve true sólo ante coincidencia con el hash, false ante contraseña distinta o hash no reconocible; entradas de tipos inválidos rechazan, sin efectos de persistencia.
 */

/**
 * @typedef {Object} TokenCryptography
 * @property {function():string} identifier Genera un identificador nuevo, no vacío e impredecible; no persiste ni publica datos.
 * @property {function(string):string} fingerprint Devuelve el SHA-256 hexadecimal en minúsculas; igual texto produce igual huella, sin efectos externos.
 */

/**
 * @typedef {Object} PlatformInformation
 * @property {function():Promise<Object>} read Devuelve título, URL pública, logos y tema canónicos ya validados; rechaza con 503 si están ausentes o no disponibles. No devuelve configuración privada ni usa valores alternativos locales.
 */

/**
 * Exige las capacidades técnicas antes de registrar las acciones; no genera tokens ni consulta Platform.
 * Las implementaciones conservan errores, cancelación del transporte y disponibilidad de su contrato.
 * @param {Object} dependencies Dependencias construidas en composición.
 * @returns {Object} La misma colección validada sin reemplazar ni invocar colaboradores.
 */
function validateSecurityTokens(dependencies) {
  requireCapability(
    dependencies.tokenCryptography,
    ['identifier', 'fingerprint'],
    'tokenCryptography',
  );
  requireCapability(dependencies.platformInformation, ['read'], 'platformInformation');
  for (const purpose of [
    'session',
    'account_confirmation',
    'password_recovery',
    'agent_execution',
  ]) {
    const context = dependencies.tokenContexts?.[purpose];
    for (const field of ['issuer', 'audience']) {
      if (typeof context?.[field] !== 'string' || !context[field].trim())
        throw new TypeError(`INVALID_CONFIGURATION:tokenContexts.${purpose}.${field}`);
    }
  }
  return dependencies;
}

module.exports = { validateSecurityTokens };
