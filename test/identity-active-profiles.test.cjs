/** @file Elegibilidad humana global y proyección mínima sin datos de acceso de otros workspaces. */
'use strict';
const test   = require('node:test');
const assert = require('node:assert/strict');
const {
  identityActiveProfilesService,
} = require('../server/modules/identity/services/identity-active-profiles.service');
const { ApplicationError } = require('../server/shared/application-error');
test('candidatos recorre el conjunto estable, filtra por nombre y omite credenciales', /** @returns {Promise<void>} Comprueba consulta canónica sin workspace y todas las páginas visibles. */ async () => {
  let query;
  const rows   = Array.from(
    { length: 125 },
    /** @param {*} unused Dato irrelevante. @param {number} index Posición. @returns {Object} Cuenta con campos privados que no deben salir. */
    (unused, index) => ({
      userCode    : 'u' + index,
      contactCode : 'c' + index,
      password    : 'secret',
      groups      : ['admin'],
    }),
  );
  const api    = identityActiveProfilesService({
    ApplicationError,
    /** @param {string} source Origen interno. @returns {void} Acreditación de prueba. */
    origin(source) {
      if (source !== 'service-projects') throw new ApplicationError(403, 'FORBIDDEN');
    },
    /** @param {string[]} codes Identidades. @returns {string[]} Selección. */ codes                     : (codes) =>
      codes,
    /** @returns {Object} Filtro de cuenta vigente. */ active                                            : () => ({
      state  : 'active',
      erased : false,
    }),
    users                                                                                                : {
      /** @param {Object} filter Filtro canónico. @returns {Promise<Object>} Usuarios independientes del workspace. */
      async getList(filter) {
        query = filter;
        return { listItem: rows };
      },
    },
    userScopes                                                                                           : { guest: {} },
    /** @param {Function} read Lector inyectado. @returns {Promise<Object>} Lectura uniforme. */ readAll :
      (read) => read(0, 100),
    /** @returns {Promise<Map>} Perfil mínimo acreditado por Directory. */ async contactProfiles() {
      return new Map(
        rows.map(
          /** @param {Object} row Cuenta. @returns {Array} Perfil sin acceso a su workspace. */
          (row) => [
            row.contactCode,
            {
              name            : 'Nombre ' + row.userCode,
              hasPicture      : false,
              pictureRevision : 7,
            },
          ],
        ),
      );
    },
  });
  const first  = await api.activeProfiles(
    {
      page    : 1,
      perPage : 100,
    },
    'service-projects',
  );
  const second = await api.activeProfiles(
    {
      page    : 2,
      perPage : 100,
    },
    'service-projects',
  );
  assert.equal(first.items.length, 100);
  assert.equal(first.items[0].pictureRevision, 7);
  assert.equal(second.items.length, 25);
  assert.equal(first.pagination.total, 125);
  assert.equal(query.workspace, undefined);
  assert.deepEqual(query.userType, { $nin: ['agent', 'external'] });
  assert.deepEqual(Object.keys(first.items[0]).sort(), [
    'contactCode',
    'hasPicture',
    'name',
    'pictureRevision',
    'userCode',
  ]);
  assert.equal(
    (await api.activeProfiles({ search: 'Nombre u124' }, 'service-projects')).items.length,
    1,
  );
  await assert.rejects(api.activeProfiles({}, 'untrusted'), { statusCode: 403 });
});
