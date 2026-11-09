/** @file Cuentas pendientes reales de Mongo: selección global sin ampliar acceso ni exponer credenciales. */
'use strict';
const test = require('node:test'),
  assert   = require('node:assert/strict'),
  mongoose = require('mongoose');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const { identityService }    = require('../server/modules/identity/services/identity.service');
const {
  identityController,
} = require('../server/modules/identity/controllers/identity.controller');
const { catalog } = require('../server/contracts');
test(
  'selección admite registered vigente; autenticación y listado común siguen exigiendo active',
  { skip: !process.env.TEST_MONGOD_BINARY },
  /** @returns {Promise<void>} Recorre repositorio, caso de uso, controlador y DTO reales. */ async () => {
    const mongo = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    try {
      const connection = mongo.connection,
        db             = connection.db;
      const model     = connection.model(
        'CandidateUsers',
        require('../server/modules/user/models/user.model').schema,
        'SECURITY_USER',
      );
      let actor       = 'active';
      const messaging = {
        /** @returns {Object} Contexto autenticado separado de las cuentas seleccionables. */
        getContext() {
          return {
            user        : { userCode: actor },
            sessionCode : 's',
            workspace   : 'alpha',
          };
        },
        /** @param {number} statusCode Estado. @param {Object} data Datos. @returns {Object} Sobre RPC. */
        successResponse(statusCode, data) {
          return {
            statusCode,
            descriptionCode : 'OK',
            data,
          };
        },
        /** @param {string} service Destino. @param {string} action Operación. @param {Object} data Códigos. @returns {Promise<Object>} Directorio sintético mínimo. */
        async request(service, action, data) {
          assert.equal(service, 'service-directory');
          assert.equal(action, 'contact-profile-get-list');
          return {
            statusCode : 200,
            data       : {
              items : data.codes
                .filter(
                  /** @param {string} code Referencia. @returns {boolean} Simula la falta de perfil. */
                  (code) => code !== 'no-profile',
                )
                .map(
                  /** @param {string} contactCode Contacto. @returns {Object} Nombre sin datos de acceso. */
                  (contactCode) => ({
                    contactCode,
                    name       : 'Nombre ' + contactCode,
                    hasPicture : false,
                  }),
                ),
            },
          };
        },
      };
      const base      = {
        workspace    : 'allWorkspaces',
        userCreate   : 'admin',
        userAssigned : '',
        erased       : false,
        validity     : Date.now() + 3600000,
        userType     : 'internal',
        workspaces   : ['alpha'],
        password     : 'not-public',
        groups       : ['not-public'],
      };
      await db.collection('SECURITY_USER').insertMany([
        {
          ...base,
          userCode    : 'active',
          contactCode : 'active',
          state       : 'active',
          user        : 'active@example.invalid',
        },
        {
          ...base,
          userCode    : 'pending',
          contactCode : 'pending',
          state       : 'registered',
          user        : 'pending@example.invalid',
          workspaces  : ['beta'],
        },
        {
          ...base,
          userCode    : 'expired',
          contactCode : 'expired',
          state       : 'registered',
          validity    : Date.now() - 1,
        },
        {
          ...base,
          userCode    : 'blocked',
          contactCode : 'blocked',
          state       : 'blocked',
        },
        {
          ...base,
          userCode    : 'inactive',
          contactCode : 'inactive',
          state       : 'inactive',
        },
        {
          ...base,
          userCode    : 'erased',
          contactCode : 'erased',
          state       : 'registered',
          erased      : true,
        },
        {
          ...base,
          userCode    : 'agent',
          contactCode : 'agent',
          state       : 'registered',
          userType    : 'agent',
        },
        {
          ...base,
          userCode    : 'external',
          contactCode : 'external',
          state       : 'registered',
          userType    : 'external',
        },
      ]);
      await db.collection('SECURITY_USER').insertOne({
        ...base,
        userCode    : 'no-profile',
        contactCode : 'no-profile',
        state       : 'registered',
        user        : 'hidden@example.invalid',
      });
      const dependencies = {
        messaging,
        users      : require('../server/modules/user/repositories/user.repository')({
          model,
          messaging,
        }),
        sessions   : {
          /** @returns {Promise<Object>} Sesión cuya identidad sigue validándose en el repositorio real. */
          async getOne() {
            return {
              activeWorkspace : 'alpha',
              workspaces      : ['alpha'],
              policies        : [],
            };
          },
        },
        workspaces : {
          /** @returns {Promise<Object[]>} Workspace vigente del actor. */
          async getReferences() {
            return [{ workspaceCode: 'alpha' }];
          },
        },
      };
      dependencies.authorization = {
        /** @param {Object} input Identidad acreditada. @returns {Promise<Object>} Cuenta real y sesión sintética explícita de esta prueba de perfiles. */
        async read({ userCode, now }) {
          return {
            user       : await dependencies.users.getOne(
              {
                userCode,
                erased   : false,
                state    : 'active',
                validity : { $gt: now },
              },
              require('../server/modules/user/policies/user.policy').trustedScopes.guest,
            ),
            session    : await dependencies.sessions.getOne(),
            workspaces : ['alpha'],
          };
        },
      };
      const api    = identityService(dependencies),
        controller = identityController(dependencies);
      const [rpc]  = catalog([
        {
          name    : 'user-active-profiles-get-list',
          kind    : 'action',
          handler : controller.activeProfiles,
        },
      ]);
      const normal = await api.activeProfiles({}, 'service-projects');
      assert.deepEqual(
        normal.items.map(
          /** @param {Object} row Perfil. @returns {string} Identidad pública. */ (row) =>
            row.userCode,
        ),
        ['active'],
      );
      const response = await rpc.handler({
        data          : { includeUnconfirmed: true },
        originService : 'service-projects',
      });
      assert.deepEqual(
        response.data.items.map(
          /** @param {Object} row Perfil. @returns {string} Identidad pública. */ (row) =>
            row.userCode,
        ),
        ['active', 'pending'],
      );
      assert.deepEqual(Object.keys(response.data.items[1]).sort(), [
        'contactCode',
        'hasPicture',
        'name',
        'pictureRevision',
        'userCode',
      ]);
      const selected = await api.activeProfiles(
        {
          userCodes          : ['pending', 'no-account'],
          includeUnconfirmed : true,
        },
        'service-projects',
      );
      assert.equal(selected.items.length, 1);
      const references = await api.references(
        { codes: ['pending', 'no-profile'] },
        'service-projects',
      );
      assert.equal(
        references.items.find(
          /** @param {Object} row Referencia. @returns {boolean} Registro pendiente. */ (row) =>
            row.userCode === 'pending',
        ).email,
        '',
      );
      assert.equal(
        references.items.find(
          /** @param {Object} row Referencia. @returns {boolean} Sin perfil. */ (row) =>
            row.userCode === 'no-profile',
        ).name,
        'Sin nombre',
      );
      const directory = await api.directory({ codes: ['pending'] }, 'service-projects');
      assert.equal(directory.items[0].name, 'Nombre pending');
      assert.equal(directory.items[0].email, '');
      const absent = await api.directory({ codes: ['no-profile'] }, 'service-projects');
      assert.equal(absent.items[0].name, 'Sin nombre');
      assert.equal(absent.items[0].email, '');
      assert.equal((await api.directory({}, 'service-projects')).pagination.total, 1);
      await assert.rejects(
        rpc.handler({
          data          : { includeUnconfirmed: 'true' },
          originService : 'service-projects',
        }),
        { statusCode: 400 },
      );
      await assert.rejects(api.activeProfiles({ includeUnconfirmed: true }, 'outside'), {
        statusCode : 403,
      });
      actor = 'pending';
      await assert.rejects(api.current('service-projects'), { statusCode: 401 });
      await db.collection('SECURITY_USER').updateOne(
        { userCode: 'pending' },
        {
          $set : {
            state      : 'active',
            workspaces : ['alpha'],
          },
        },
      );
      assert.equal((await api.current('service-projects')).userCode, 'pending');
    } finally {
      await mongo.stop();
    }
  },
);
