/** @file Suites reutilizables de conformidad de firma y hash: no requieren repositorios, red, configuración global ni secretos reales. */
'use strict';
const assert = require('node:assert/strict');

/**
 * Comprueba los resultados y rechazos requeridos por el puerto síncrono de credenciales.
 * @param {Object} jwt Implementación de sign, verify y decode que se pretende sustituir.
 * @returns {void} Finaliza tras acreditar firma, contexto, algoritmo y caducidad.
 */
function verifyTokenSigner(jwt) {
  const key      = 'fixture-local-signer-no-production';
  const payload  = {
    purpose       : 'agent_execution',
    userCode      : 'u',
    agentRevision : 2,
  };
  const expected = { ...payload };
  const context  = {
    issuer   : 'urn:fixture:security',
    audience : 'urn:fixture:agent_execution',
  };
  const token    = jwt.sign(payload, key, {
    algorithm : 'HS256',
    expiresIn : 120,
    ...context,
  });
  assert.equal(typeof token, 'string');
  assert.deepEqual(payload, expected);
  const claims = jwt.verify(token, key, {
    algorithms : ['HS256'],
    ...context,
  });
  assert.equal(claims.purpose, payload.purpose);
  assert.equal(claims.userCode, payload.userCode);
  assert.equal(claims.agentRevision, payload.agentRevision);
  assert.equal(claims.exp - claims.iat, 120);
  assert.equal(jwt.decode(token).exp, claims.exp);
  assert.equal(jwt.decode('invalid-fixture'), null);
  for (const options of [
    {
      algorithms : ['HS384'],
      ...context,
    },
    {
      algorithms : ['HS256'],
      ...context,
      issuer     : 'urn:fixture:other',
    },
    {
      algorithms : ['HS256'],
      ...context,
      audience   : 'urn:fixture:session',
    },
  ]) {
    /** @returns {Object} Rechaza una credencial cuyo contexto o algoritmo no es el autorizado. */
    function invalidContext() {
      return jwt.verify(token, key, options);
    }
    assert.throws(invalidContext);
  }
  /** @returns {Object} Rechaza una firma con una clave diferente. */
  function wrongKey() {
    return jwt.verify(token, key + '-other', {
      algorithms : ['HS256'],
      ...context,
    });
  }
  assert.throws(wrongKey);
  const expired = jwt.sign(
    {
      ...payload,
      exp : 1,
    },
    key,
    {
      algorithm : 'HS256',
      ...context,
    },
  );
  /** @returns {Object} Rechaza una credencial cuya caducidad ya venció. */
  function expiredToken() {
    return jwt.verify(expired, key, {
      algorithms : ['HS256'],
      ...context,
    });
  }
  assert.throws(expiredToken);
  const parts       = token.split('.');
  const replacement = {
    ...claims,
    userCode : 'another-user',
  };
  parts[1] = Buffer.from(JSON.stringify(replacement)).toString('base64url');
  /** @returns {Object} Rechaza afirmaciones modificadas aunque la codificación sea JSON válida. */
  function alteredClaims() {
    return jwt.verify(parts.join('.'), key, {
      algorithms : ['HS256'],
      ...context,
    });
  }
  assert.throws(alteredClaims);
}

/**
 * Comprueba hash bcrypt, comparación y rechazos sin utilizar contraseñas de usuarios reales.
 * @param {Object} hasher Implementación asíncrona de hash y compare.
 * @returns {Promise<void>} Finaliza al acreditar resultado, coincidencia y entrada inválida.
 */
async function verifyPasswordHasher(hasher) {
  const password = 'fixture-password-only';
  const encoded  = await hasher.hash(password, 4);
  assert.equal(typeof encoded, 'string');
  assert.notEqual(encoded, password);
  assert.match(encoded, /^\$2[aby]\$04\$/);
  assert.equal(await hasher.compare(password, encoded), true);
  assert.equal(await hasher.compare('different-fixture', encoded), false);
  assert.equal(await hasher.compare(password, 'invalid-hash'), false);
  /** @returns {Promise<string>} Rechaza un tipo de contraseña no admitido. */
  function invalidPassword() {
    return hasher.hash(null, 4);
  }
  await assert.rejects(invalidPassword);
}

module.exports = {
  verifyTokenSigner,
  verifyPasswordHasher,
};
