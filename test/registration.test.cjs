/** @file Alta pública: contrato, coordinación del contacto y activación por correo. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  userRegistrationService,
} = require('../server/modules/user/services/user-registration.service');
const { ApplicationError } = require('../server/shared/application-error');
const dtos                 = require('../server/modules/user/dtos/user.actions.dto');
/** Construye puertos aislados y registra los efectos de la coordinación.
 * @returns {Object} Caso de uso, entradas observadas y registros persistidos.
 */
function fixture() {
  const users = [],
    contacts  = [],
    emails    = [];
  const scopes  = { guest: Symbol('guest') };
  const service = userRegistrationService({
    ApplicationError,
    /** Entrega la configuración fija de activación de la prueba.
     * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
     */
    confirmationSettings : async () => ({}),
    /** Emite un marcador local sin crear credenciales reales.
     * @returns {*} Resultado observado por las aserciones de la prueba.
     */
    confirmationToken    : () => 'activation-fixture',
    controller           : 'user',
    counter              : {
      /** Asigna un identificador reproducible al registro ficticio.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      getObjectCode : async () => 'USR1',
    },
    dependencies         : {},
    id                   : 'test',
    logger               : {
      /** Omite registros técnicos del colaborador aislado.
       * @returns {*} Resultado observado por las aserciones de la prueba.
       */ error() {},
    },
    platformInformation  : {
      /** Entrega la identidad visual y el destino del correo de prueba.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      read : async () => ({
        publicUrl : 'https://example.invalid',
        title     : 'CARGAP',
      }),
    },
    messaging            : {
      /** Entrega el contexto del titular simulado para evaluar autorización.
       * @returns {*} Resultado observado por las aserciones de la prueba.
       */
      getContext   : () => ({ idTransaction: 'fixture' }),
      /** Captura el contacto remitido a Directory y devuelve su identidad canónica.
       * @param {*} target Entrada del colaborador aislado.
       * @param {*} action Entrada del colaborador aislado.
       * @param {*} data Entrada del colaborador aislado.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      request      : async (target, action, data) => {
        assert.equal(target, 'service-directory');
        assert.equal(action, 'contact-register');
        contacts.push(data);
        return {
          statusCode : 201,
          data       : {
            contactCode : 'CON1',
            userCode    : 'CON1',
          },
        };
      },
      /** Acepta eventos de la prueba sin conectarse a un broker.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      publishEvent : async () => {},
      /** Captura la activación por correo sin enviar mensajes externos.
       * @param {*} target Entrada del colaborador aislado.
       * @param {*} action Entrada del colaborador aislado.
       * @param {*} data Entrada del colaborador aislado.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      sendCommand  : async (target, action, data) => {
        if (action === 'email-send-transactional') emails.push(data);
      },
    },
    userPolicy           : {
      /** Autoriza la creación inicial y rechaza la reactivación pública.
       * @param {*} action Entrada del colaborador aislado.
       * @param {*} data Entrada del colaborador aislado.
       * @returns {*} Resultado observado por las aserciones de la prueba.
       */
      authorize : (action, data) => (action === 'create' ? data : null),
    },
    userRepository       : {
      /** Busca un registro previamente creado para detectar un segundo alta.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      getOne : async () => users[0] || null,
      /** Conserva una copia de la escritura para verificar los datos persistidos.
       * @param {*} data Entrada del colaborador aislado.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      create : async (data) => {
        const row = {
          ...data,
          state : 'registered',
        };
        users.push(row);
        return row;
      },
    },
    userScopes           : scopes,
    userState            : {},
    utilities            : {
      /** Lee el catálogo ficticio completo de membresías.
       * @param {*} read Entrada del colaborador aislado.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      collectPages   : async (read) =>
        read({
          page    : 1,
          perPage : 100,
        }),
      /** Compara las membresías persistidas con las solicitadas.
       * @param {*} a Entrada del colaborador aislado.
       * @param {*} b Entrada del colaborador aislado.
       * @returns {*} Resultado observado por las aserciones de la prueba.
       */
      arraysAreEqual : (a, b) => JSON.stringify(a) === JSON.stringify(b),
    },
    workspacesScopes     : scopes,
    /** Expone el catálogo aislado de espacios vigentes.
     * @returns {*} Resultado observado por las aserciones de la prueba.
     */
    workspacesService    : () => ({
      /** Busca un registro previamente creado para detectar un segundo alta.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      getOne  : async () => ({ workspaceCode: 'WS' }),
      /** Entrega únicamente los registros ficticios preparados por la prueba.
       * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
       */
      getList : async () => ({ items: [{ workspaceCode: 'WS' }] }),
    }),
  });
  return {
    service,
    users,
    contacts,
    emails,
  };
}
/** Datos ficticios de la app; nunca incluyen código SMS, consentimiento ni contraseña.
 * @returns {Object} Solicitud válida de alta.
 */
function input() {
  return {
    user          : ' ANA@EXAMPLE.INVALID ',
    roleCode      : '100-customer',
    workspaceCode : 'allWorkspaces',
    name          : {
      firstName        : ' Ana ',
      lastNamePaternal : ' Pérez ',
      lastNameMaternal : ' López ',
      preferredName    : ' Anita ',
    },
    phone         : {
      countryCode : '+52',
      number      : '5512345678',
    },
  };
}
test('Security coordina el contacto, conserva estado registrado y envía activación', /** Verifica: Security coordina el contacto, conserva estado registrado y envía activación.
 * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
 */ async () => {
  const f = fixture();
  dtos['user-register'].input(input());
  const user = await f.service.register(input());
  assert.equal(user.userCode, user.contactCode);
  assert.equal(user.state, 'registered');
  assert.equal(user.password, '');
  assert.equal(f.contacts.length, 1);
  assert.deepEqual(f.contacts[0].name, {
    firstName        : 'Ana',
    lastNamePaternal : 'Pérez',
    lastNameMaternal : 'López',
    preferredName    : 'Anita',
  });
  assert.deepEqual(f.contacts[0].phone, {
    countryCode : '52',
    number      : '5512345678',
  });
  assert.equal(f.contacts[0].workspaceCode, 'allWorkspaces');
  assert.equal(f.users[0].name, undefined);
  assert.equal(f.users[0].preferredName, undefined);
  assert.equal(f.emails.length, 1);
  assert.equal(f.emails[0].template, 'security-user-confirm');
  assert.equal(f.emails[0].email, 'ana@example.invalid');
  assert.match(JSON.parse(f.emails[0].data).token, /\/confirm\//);
  await assert.rejects(f.service.register(input()));
  assert.equal(f.contacts.length, 1);
});
test('el contrato rechaza SMS verificado y datos inválidos antes de crear registros', /** Verifica: el contrato rechaza SMS verificado y datos inválidos antes de crear registros.
 * @returns {Promise<*>} Resultado observado por las aserciones de la prueba.
 */ async () => {
  const f = fixture();
  assert.throws(
    /** Comprueba que una consulta o entrada privada sea rechazada.
     * @returns {*} Resultado observado por las aserciones de la prueba.
     */ () =>
      dtos['user-register'].input({
        ...input(),
        code : '12345',
      }),
  );
  assert.throws(
    /** Comprueba que una consulta o entrada privada sea rechazada.
     * @returns {*} Resultado observado por las aserciones de la prueba.
     */ () =>
      dtos['user-register'].input({
        ...input(),
        phone : {
          ...input().phone,
          verified : true,
        },
      }),
  );
  await assert.rejects(
    f.service.register({
      ...input(),
      phone : {
        countryCode : '0',
        number      : 'abc',
      },
    }),
  );
  await assert.rejects(
    f.service.register({
      ...input(),
      name : {
        ...input().name,
        preferredName : 'x'.repeat(101),
      },
    }),
  );
  assert.equal(f.contacts.length, 0);
  assert.equal(f.users.length, 0);
  assert.equal(f.emails.length, 0);
});
