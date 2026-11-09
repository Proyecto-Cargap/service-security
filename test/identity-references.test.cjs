/** @file Referencias públicas agrupadas: equivalencia de visibilidad, límites y revocación. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  identityReferencesService,
} = require('../server/modules/identity/services/identity-references.service');
const { validate } = require('../server/contracts/action-dto');
const manifest     = require('../server/contracts/service.json');

test('referencias conservan nombres históricos autorizados sin recuperar correos inactivos', /** @returns {Promise<void>} Una lectura acotada y un único lote de perfiles; el siguiente request reacredita permisos. */ async () => {
  let authorized = true,
    reads        = 0,
    projections  = 0;
  const future = Date.now() + 60000;
  const rows   = [
    {
      userCode : 'active',
      user     : 'active@example.test',
      state    : 'active',
      validity : future,
    },
    {
      userCode : 'pending',
      user     : 'private@example.test',
      state    : 'registered',
      validity : future,
    },
    {
      userCode : 'inactive',
      user     : 'hidden@example.test',
      state    : 'inactive',
      validity : future,
    },
    {
      userCode : 'expired',
      user     : 'expired@example.test',
      state    : 'active',
      validity : 1,
    },
    {
      userCode   : 'agent',
      user       : 'agent@example.test',
      userType   : 'agent',
      state      : 'active',
      validity   : future,
      workspaces : ['w'],
    },
    {
      userCode   : 'external',
      user       : 'external@example.test',
      userType   : 'external',
      state      : 'active',
      validity   : future,
      workspaces : ['other'],
    },
    {
      userCode : 'absent',
      user     : 'absent@example.test',
      state    : 'inactive',
      validity : future,
    },
  ];
  const api    = identityReferencesService({
    /** @param {string[]} codes Códigos explícitos. @returns {string[]} Selector limitado. */
    codes(codes) {
      assert.ok(codes.length <= 100);
      return [...new Set(codes)];
    },
    /** @returns {Promise<Object>} Autoridad mutable entre solicitudes. */
    async current() {
      if (!authorized) throw Object.assign(new Error('REVOKED'), { statusCode: 401 });
      return { workspace: 'w' };
    },
    userScopes : { guest: 'internal' },
    users      : {
      /** @param {string[]} codes Lote. @param {string} fields Proyección. @param {string} scope Política. @returns {Promise<Object[]>} Sólo referencias acreditadas. */
      async getReferences(codes, fields, scope) {
        reads++;
        assert.equal(scope, 'internal');
        assert.ok(!fields.includes('token'));
        return rows.filter(
          /** @param {Object} row Referencia de prueba. @returns {*} Selección o proyección comprobada. */ (
            row,
          ) => codes.includes(row.userCode),
        );
      },
    },
    /** @param {Object[]} selected Referencias. @returns {Promise<Map>} Perfiles autorizados por Directory. */
    async contactProfiles(selected) {
      projections++;
      return new Map(
        selected
          .filter(
            /** @param {Object} row Referencia de prueba. @returns {*} Selección o proyección comprobada. */ (
              row,
            ) => !['absent', 'pending'].includes(row.userCode),
          )
          .map(
            /** @param {Object} row Referencia de prueba. @returns {*} Selección o proyección comprobada. */ (
              row,
            ) => [
              row.userCode,
              {
                name            : 'Nombre ' + row.userCode,
                pictureRevision : 7,
              },
            ],
          ),
      );
    },
  });
  const result = await api.references(
    {
      codes : rows.map(
        /** @param {Object} row Referencia de prueba. @returns {*} Selección o proyección comprobada. */ (
          row,
        ) => row.userCode,
      ),
    },
    'service-communication',
  );
  assert.equal(reads, 1);
  assert.equal(projections, 1);
  assert.equal(
    validate(
      result,
      manifest.endpoints.find(
        /** @param {Object} e Contrato. @returns {boolean} Acción canónica. */ (e) =>
          e.name === 'user-references-get-list',
      ).successData,
    ),
    true,
  );
  const byCode = new Map(
    result.items.map(
      /** @param {Object} row Referencia de prueba. @returns {*} Selección o proyección comprobada. */ (
        row,
      ) => [row.userCode, row],
    ),
  );
  assert.equal(byCode.get('active').email, 'active@example.test');
  assert.equal(byCode.get('pending').name, 'Sin nombre');
  for (const code of ['pending', 'inactive', 'expired', 'agent', 'external'])
    assert.equal(byCode.get(code).email, '');
  assert.equal(byCode.get('inactive').name, 'Nombre inactive');
  assert.equal(byCode.has('absent'), false);
  authorized = false;
  await assert.rejects(api.references({ codes: ['active'] }, 'service-communication'), {
    statusCode : 401,
  });
  assert.equal(reads, 1);
});
