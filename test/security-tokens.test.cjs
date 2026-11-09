/** @file Conformidad criptográfica, configuración inmutable y validación sin efectos de los puertos de tokens. */
'use strict';
const test                       = require('node:test');
const assert                     = require('node:assert/strict');
const cryptography               = require('../server/adapters/security/token-cryptography');
const { tokenContexts }          = require('../server/adapters/security/token-contexts');
const { validateSecurityTokens } = require('../server/modules/security/ports/security-tokens.port');

/**
 * Comprueba las garantías observables de identificadores y huellas sin datos privados reales.
 * @returns {void} Finaliza al verificar vectores conocidos y unicidad de identificadores.
 */
function verifyCryptography() {
  assert.equal(
    cryptography.fingerprint(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    cryptography.fingerprint('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  const identifiers = new Set();
  for (let index = 0; index < 100; index++) {
    const value = cryptography.identifier();
    assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    identifiers.add(value);
  }
  assert.equal(identifiers.size, 100);
}

/**
 * Conserva emisores y audiencias vigentes como valores independientes del entorno mutable.
 * @returns {void} Finaliza al comprobar todos los propósitos y la ausencia de valores alternativos.
 */
function verifyContexts() {
  const environment = {
    PLATFORM_ID : 'fixture',
    ENV_NAME    : 'test',
  };
  const contexts    = tokenContexts(environment);
  environment.PLATFORM_ID = 'other';
  environment.ENV_NAME = 'prod';
  for (const purpose of [
    'session',
    'account_confirmation',
    'password_recovery',
    'agent_execution',
  ]) {
    assert.deepEqual(contexts[purpose], {
      issuer   : 'urn:xidden:fixture:test:security',
      audience : `urn:xidden:fixture:test:${purpose}`,
    });
    assert.equal(Object.isFrozen(contexts[purpose]), true);
  }
  assert.equal(Object.isFrozen(contexts), true);
  /** @returns {Object} Configuración cuya identidad ausente debe impedir la composición. */
  function missingIdentity() {
    return tokenContexts({});
  }
  assert.throws(missingIdentity, /PLATFORM_ID_AND_ENV_NAME_REQUIRED/);
}

/**
 * Valida colaboradores mínimos sin invocarlos y conserva la identidad de sus errores.
 * @returns {Promise<void>} Finaliza al acreditar construcción sin red ni generación de tokens.
 */
async function verifyPorts() {
  let calls     = 0;
  const failure = new Error('unavailable');
  /** @returns {string} Identificador simulado únicamente si se invoca la capacidad. */
  function identifier() {
    calls++;
    return 'fixture';
  }
  /** @param {string} value Texto recibido por el colaborador sustituible.
   * @returns {string} Huella simulada; la validación de construcción no debe invocarla.
   */
  function fingerprint(value) {
    calls++;
    return value;
  }
  /** @returns {Promise<never>} Indisponibilidad que debe conservarse sin reintentos implícitos. */
  async function read() {
    calls++;
    throw failure;
  }
  const dependencies = {
    tokenCryptography   : {
      identifier,
      fingerprint,
    },
    platformInformation : { read },
    tokenContexts       : tokenContexts({
      PLATFORM_ID : 'fixture',
      ENV_NAME    : 'test',
    }),
  };
  assert.equal(validateSecurityTokens(dependencies), dependencies);
  assert.equal(calls, 0);
  /** @returns {Object} Configuración sin un método obligatorio del colaborador criptográfico. */
  function missingCryptography() {
    return validateSecurityTokens({
      ...dependencies,
      tokenCryptography : { identifier },
    });
  }
  /** @returns {Object} Configuración con contexto JWT incompleto. */
  function missingAudience() {
    return validateSecurityTokens({
      ...dependencies,
      tokenContexts : {},
    });
  }
  assert.throws(missingCryptography, /INVALID_CAPABILITY:tokenCryptography.fingerprint/);
  assert.throws(missingAudience, /INVALID_CONFIGURATION:tokenContexts.session.issuer/);
  assert.equal(calls, 0);
  /** @param {Error} error Fallo propagado por el puerto.
   * @returns {boolean} Coincidencia con el error original sin traducciones implícitas.
   */
  function originalError(error) {
    return error === failure;
  }
  await assert.rejects(dependencies.platformInformation.read(), originalError);
  assert.equal(calls, 1);
}

test(
  'el adaptador criptográfico conserva SHA-256 e identificadores de un solo uso',
  verifyCryptography,
);
test('los contextos JWT son explícitos, inmutables y conservan emisor y audiencia', verifyContexts);
test(
  'los puertos de tokens se validan sin efectos y conservan los errores del colaborador',
  verifyPorts,
);
