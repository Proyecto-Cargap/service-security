/** @file Pruebas de comportamiento de platform-configuration.test en service-security. */
'use strict';
const tokenCryptography = require('../server/adapters/security/token-cryptography');
const tokenContexts     = require('../server/adapters/security/token-contexts').tokenContexts({
  PLATFORM_ID : 'fixture',
  ENV_NAME    : 'test',
});
const test              = require('node:test');
const assert            = require('node:assert/strict');
const configuration     = require('../server/modules/settings/services/platform-configuration.service');
const createRecovery    = require('../server/modules/user/services/user-password-recovery');
/**
 * Ejecuta fixture dentro del flujo de platform-configuration.test.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
const fixture           = () => ({
  title     : 'Example',
  publicUrl : 'https://example.invalid',
  logos     : { email: 'https://example.invalid/assets/branding/logoLight.svg' },
  theme     : { primary: { 900: '#78192b' } },
});

test('Security obtains platform information by RPC with a bounded timeout' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const data = fixture(),
    calls    = [];
  const result = await configuration.get({
    /**
     * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
     * @param {...*} args Valor de args utilizado por esta operación.
     * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    request : async (...args) => {
      calls.push(args);
      return {
        statusCode : 200,
        data,
      };
    },
  });
  assert.deepEqual(calls, [
    ['service-platform', 'configuration-get-information', {}, { timeoutMs: 8000 }],
  ]);
  assert.deepEqual(result, data);
});

test('RPC failures and invalid responses fail closed; uncertainty is preserved' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  for (const response of [
    null,
    { statusCode: 503 },
    {
      statusCode : 200,
      data       : {
        menus : {
          public : [],
          main   : [],
        },
      },
    },
    {
      statusCode : 200,
      data       : {
        ...fixture(),
        publicUrl : 'javascript:alert(1)',
      },
    },
    {
      statusCode : 200,
      data       : {
        ...fixture(),
        logos : { email: '/relative.svg' },
      },
    },
  ]) {
    await assert.rejects(
      configuration.get({
        /**
         * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
         * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        request : async () => response,
      }),
      /**
       * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
       * @param {Error} error Fallo recibido por la continuación.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (error) => error.statusCode === 503 && error.descriptionCode === 'N0001-CONFIG-UNAVAILABLE',
    );
  }
  const cause = Object.assign(new Error('timeout'), { uncertain: true });
  await assert.rejects(
    configuration.get({
      /**
       * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
       * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
       */
      request : async () => {
        throw cause;
      },
    }),
    /**
     * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
     * @param {Error} error Fallo recibido por la continuación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (error) => error.statusCode === 503 && error.uncertain === true && error.cause === cause,
  );
});

test('password recovery waits for central information before issuing a token and sending the email' /**
 * Verifica el comportamiento esperado del caso de prueba.
 * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
 */, async () => {
  const data = fixture(),
    events   = [],
    row      = {
      _id       : 'row',
      user      : 'person@example.invalid',
      userCode  : 'user',
      workspace : 'workspace',
    };
  const savedEnvironment = {
    PLATFORM_ID : process.env.PLATFORM_ID,
    ENV_NAME    : process.env.ENV_NAME,
  };
  process.env.PLATFORM_ID = 'fixture';
  process.env.ENV_NAME = 'invalid-for-core';
  try {
    const recoveryMessaging = {
      /**
       * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
       * @param {*} service Valor de service utilizado por esta operación.
       * @param {string} action Valor de action utilizado por esta operación.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      request     : async (service, action) => {
        assert.equal(service, 'service-platform');
        assert.equal(action, 'configuration-get-information');
        events.push('configuration');
        return {
          statusCode : 200,
          data,
        };
      },
      /**
       * Ejecuta sendCommand dentro del flujo de platform-configuration.test.
       * @param {*} service Valor de service utilizado por esta operación.
       * @param {string} action Valor de action utilizado por esta operación.
       * @param {*} payload Valor de payload utilizado por esta operación.
       * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
       */
      sendCommand : async (service, action, payload) => {
        assert.equal(service, 'service-connect');
        assert.equal(action, 'email-send-transactional');
        events.push('mail');
        const content = JSON.parse(payload.data);
        assert.equal(content.company, data.title);
        assert.equal(Object.hasOwn(content, 'logo'), false);
        assert.equal(Object.hasOwn(content, 'buttonColor'), false);
        assert.equal(content.token, 'https://example.invalid/change/fixture-token');
      },
    };
    const recovery          = createRecovery({
      userRepository      : {
        /**
         * Obtiene el registro que cumple los filtros autorizados.
         * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        getOne : async () => row,
        /**
         * Actualiza los campos autorizados del registro.
         * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        update : async () => {
          events.push('save');
          return row;
        },
      },
      sessionRepository   : {},
      messaging           : recoveryMessaging,
      tokenCryptography,
      tokenContexts,
      platformInformation : {
        /** Consulta el puerto real de configuración usando el transporte aislado de esta prueba.
         * @returns {Promise<Object>} Información canónica o indisponibilidad.
         */
        read() {
          return configuration.get(recoveryMessaging);
        },
      },
      jwt                 : {
        /**
         * Ejecuta sign dentro del flujo de platform-configuration.test.
         * @returns {string} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        sign : () => {
          events.push('token');
          return 'fixture-token';
        },
      },
      bcrypt              : {},
      tokenSecret         : 'fixture-only',
      logger              : {
        /**
         * Ejecuta error dentro del flujo de platform-configuration.test.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        error : () => assert.fail('unexpected error'),
      },
    });
    await recovery.request({ user: row.user });
    assert.deepEqual(events, ['configuration', 'token', 'save', 'mail']);
    let writes = 0,
      errors   = 0;
    const unavailableMessaging = {
      /**
       * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
       * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      request     : async () => ({ statusCode: 503 }),
      /**
       * Ejecuta sendCommand dentro del flujo de platform-configuration.test.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      sendCommand : () => assert.fail('unexpected mail'),
    };
    const unavailable          = createRecovery({
      userRepository      : {
        /**
         * Obtiene el registro que cumple los filtros autorizados.
         * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        getOne : async () => row,
        /**
         * Actualiza los campos autorizados del registro.
         * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
         */
        update : async () => {
          writes++;
        },
      },
      sessionRepository   : {},
      messaging           : unavailableMessaging,
      tokenCryptography,
      tokenContexts,
      platformInformation : {
        /** Consulta el puerto real de configuración usando el transporte aislado de esta prueba.
         * @returns {Promise<Object>} Información canónica o indisponibilidad.
         */
        read() {
          return configuration.get(unavailableMessaging);
        },
      },
      jwt                 : {
        /**
         * Ejecuta sign dentro del flujo de platform-configuration.test.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        sign : () => assert.fail('unexpected token'),
      },
      bcrypt              : {},
      tokenSecret         : 'fixture-only',
      logger              : {
        /**
         * Ejecuta error dentro del flujo de platform-configuration.test.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        error : () => errors++,
      },
    });
    assert.equal(await unavailable.request({ user: row.user }), null);
    assert.equal(writes, 0);
    assert.equal(errors, 1);
  } finally {
    for (const [key, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
