/** @file Identidad externa con persistencia Mongo real: usuario único, sesiones acotadas, membresía canónica y revocación. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const { createHash }         = require('node:crypto');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const {
  externalPrincipalService,
} = require('../server/modules/external-principal/services/external-principal.service');
const { identityService } = require('../server/modules/identity/services/identity.service');
test(
  'Mongo real conserva identidad externa, una sesión por intervalo y expiración independiente de sesiones humanas',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : 60000,
  },
  /** @returns {Promise<void>} Replica set aislado; usa repositorios reales y elimina únicamente sus datos. */
  async () => {
    const mongoose = require('mongoose');
    const isolated = await startIsolatedMongo({
      binary : process.env.TEST_MONGOD_BINARY,
      mongoose,
    });
    try {
      const userModel    = isolated.connection.model(
        'ExternalUser',
        require('../server/modules/user/models/user.model').schema.clone(),
        'SECURITY_USER',
      );
      const sessionModel = isolated.connection.model(
        'ExternalSession',
        require('../server/modules/session/models/session.model').schema.clone(),
        'SECURITY_SESSION',
      );
      await userModel.createCollection();
      await sessionModel.createCollection();
      await userModel.createIndexes();
      await sessionModel.createIndexes();
      let context        = {};
      const messaging    = {
        /** @param {string} name Evento. @param {Object} data Referencia. @param {Object} options Sesión productora. @returns {Promise<Object>} Outbox aislado en la misma transacción. */
        publishEvent(name, data, options) {
          return isolated.connection.db.collection('TEST_OUTBOX').insertOne(
            {
              name,
              data,
            },
            options,
          );
        },

        /** @returns {Object} Contexto controlado de transporte. */ getContext : () => context,
      };
      const users        = require('../server/modules/user/repositories/user.repository')({
        model : userModel,
        messaging,
      });
      const sessions     = require('../server/modules/session/repositories/session.repository')({
        model : sessionModel,
        messaging,
      });
      const userScope    = require('../server/modules/user/policies/user.policy').trustedScopes.guest;
      const sessionScope = require('../server/modules/session/policies/session.policy')
        .trustedScopes.guest;
      const workspaces   = {
        /** @returns {Promise<Object>} Workspace vigente. */ async getOne() {
          return { workspaceCode: 'w' };
        },
        /** @returns {Promise<Object[]>} Referencias de membresía canónica. */ async getReferences() {
          return [{ workspaceCode: 'w' }];
        },
      };
      const groups       = {
        /** @returns {Promise<Object>} Grupo válido del workspace. */ async getOne() {
          return { workspace: 'w' };
        },
      };
      await users.create(
        {
          userCode     : 'owner',
          user         : 'owner@example.test',
          workspace    : 'w',
          workspaces   : ['w'],
          userCreate   : 'owner',
          userAssigned : '',
          state        : 'active',
          validity     : Date.now() + 86400000,
        },
        userScope,
      );
      const service    = externalPrincipalService({
        users,
        sessions,
        workspaces,
        groups,
        userScope,
        sessionScope,
        now                                                                                                         : Date.now,
        /** @param {string} input Identificadores internos. @returns {string} Huella no interactiva. */ fingerprint :
          (input) => createHash('sha256').update(input).digest('hex'),
        /** @param {Object} input Principal solicitado. @returns {Promise<Object>} Permisos aislados por sujeto. */
        async principals(input) {
          return {
            items : [
              {
                userCode : input.userCodes[0],
                policies :
                  input.userCodes[0] === 'owner'
                    ? ['connect.meta.update.global']
                    : ['security.user.update.global'],
              },
            ],
          };
        },
      });
      const input      = {
        contactCode      : 'external',
        workspaceCode    : 'w',
        conversationCode : 'meta-conversation',
        ownerUserCode    : 'owner',
        groups           : [],
      };
      const identities = await Promise.all(
        Array.from(
          { length: 8 },
          /** @returns {Promise<Object>} Alta concurrente del mismo sujeto. */
          () => service.provision(input, 'service-apigateway'),
        ),
      );
      assert(
        identities.every(
          /** @param {Object} identity Resultado concurrente. @returns {boolean} Identificador invariable. */
          (identity) => identity.userCode === 'external',
        ),
      );
      assert.equal(await userModel.countDocuments({ userType: 'external' }), 1);
      const results = await Promise.all(
        Array.from(
          { length: 8 },
          /** @returns {Promise<Object>} Resuelve sesión sin JWT. */
          () => service.resolve(input, 'service-apigateway'),
        ),
      );
      assert.equal(
        new Set(
          results.map(
            /** @param {Object} result Sesión emitida. @returns {string} Identificador interno. */
            (result) => result.context.sessionCode,
          ),
        ).size,
        1,
      );
      assert.equal(await sessionModel.countDocuments({ userCode: 'external' }), 1);
      const stored = await sessionModel.findOne({ userCode: 'external' }).lean();
      assert(stored.externalExpiresAt instanceof Date);
      assert.equal(stored.externalConversationCode, 'meta-conversation');
      assert(!stored.policies.includes('security.user.update.global'));
      context = results[0].context;
      const workspaceModel = isolated.connection.model(
        'IdentityExternalWorkspace',
        require('../server/modules/workspaces/models/workspaces.model').schema.clone(),
      );
      await workspaceModel.createCollection();
      await workspaceModel.collection.insertOne({
        workspaceCode : 'w',
        workspace     : 'w',
        userCreate    : 'owner',
        userAssigned  : '',
        erased        : false,
      });
      const identity = identityService({
        messaging,
        authorization :
          require('../server/modules/identity/repositories/identity-authorization.repository').identityAuthorizationRepository(
            {
              session   : sessionModel,
              user      : userModel,
              workspace : workspaceModel,
              messaging,
            },
          ),
        users,
        sessions,
        workspaces,
      });
      assert.equal((await identity.current('service-communication')).userCode, 'external');
      await service.resolve(
        {
          ...input,
          groups : ['new-external-profile'],
        },
        'service-apigateway',
      );
      assert.deepEqual((await userModel.findOne({ userCode: 'external' }).lean()).groups, [
        'new-external-profile',
      ]);
      await sessionModel.updateMany(
        { userCode: 'external' },
        { $set: { expiration: Math.floor(Date.now() / 1000) - 1 } },
      );
      await assert.rejects(identity.current('service-communication'), { statusCode: 401 });
      await userModel.updateOne({ userCode: 'owner' }, { $set: { state: 'blocked' } });
      await assert.rejects(service.resolve(input, 'service-apigateway'), {
        descriptionCode : 'META_OWNER_UNAVAILABLE',
      });
      const indexes = await sessionModel.collection.indexes();
      assert(
        indexes.some(
          /** @param {Object} index Índice instalado. @returns {boolean} TTL sólo del campo externo. */
          (index) => index.key.externalExpiresAt === 1 && index.expireAfterSeconds === 0,
        ),
      );
    } finally {
      await isolated.stop();
    }
  },
);
