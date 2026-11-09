/** @file Acceso propio con Mongo real: permisos vigentes, aislamiento, revocación y ninguna escritura de sesión. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const {
  identityController,
} = require('../server/modules/identity/controllers/identity.controller');
const { catalog }      = require('../server/contracts');
const { readSnapshot } = require('../server/adapters/mongodb/read-snapshot');
test(
  'acceso propio proyecta permisos vigentes y membresías nuevas sin renovar ni escribir la sesión',
  { skip: !process.env.TEST_MONGOD_BINARY },
  /** @returns {Promise<void>} Usa modelos, repositorios, controlador y DTO productivos. */
  async () => {
    const mongo = await startIsolatedMongo({
      binary          : process.env.TEST_MONGOD_BINARY,
      monitorCommands : true,
      mongoose,
    });
    try {
      const connection = mongo.connection;
      const repositories = {},
        models           = {};
      const context   = {
        user        : {
          userCode : 'u',
          userType : 'internal',
        },
        sessionCode : 's',
        workspace   : 'w',
      };
      const messaging = {
        /** @returns {Object} Contexto autenticado sintético. */ getContext() {
          return context;
        },
        /** @param {number} statusCode Estado. @param {Object} data Proyección. @returns {Object} Sobre canónico. */
        successResponse(statusCode, data) {
          return {
            statusCode,
            descriptionCode : 'OK',
            data,
          };
        },
        /** @returns {never} Esta lectura no puede publicar efectos. */ publishEvent() {
          assert.fail('READ_MUST_NOT_WRITE');
        },
      };
      for (const resource of ['user', 'session', 'group', 'policy', 'workspaces']) {
        models[resource] = connection.model(
          'OwnAccess' + resource,
          require(
            '../server/modules/' + resource + '/models/' + resource + '.model',
          ).schema.clone(),
        );
        await models[resource].createCollection();
        repositories[resource] = require(
          '../server/modules/' + resource + '/repositories/' + resource + '.repository',
        )({
          model : models[resource],
          messaging,
        });
      }
      const base = {
        workspace    : 'allWorkspaces',
        userCreate   : 'u',
        userAssigned : '',
        erased       : false,
      };
      await models.user.collection.insertOne({
        ...base,
        userCode   : 'u',
        userType   : 'internal',
        state      : 'active',
        validity   : Date.now() + 3600000,
        workspaces : ['w', 'new'],
        groups     : ['g'],
        password   : 'must-not-leak',
      });
      await models.session.collection.insertOne({
        ...base,
        sessionCode     : 's',
        userCode        : 'u',
        active          : true,
        activeWorkspace : 'w',
        workspaces      : ['w'],
        expiration      : Date.now() / 1000 + 3600,
        policies        : ['stale.permission'],
        authorization   : 'must-not-leak',
      });
      await models.workspaces.collection.insertMany([
        {
          ...base,
          workspaceCode : 'w',
          name          : 'Workspace',
        },
        {
          ...base,
          workspaceCode : 'new',
          name          : 'New workspace',
        },
      ]);
      await models.group.collection.insertOne({
        ...base,
        groupCode : 'g',
        name      : 'Group',
        policies  : ['p', 'disabled', 'other'],
      });
      await models.policy.collection.insertMany([
        {
          ...base,
          policyCode : 'p',
          identifier : 'security.user.view.workspace',
          active     : true,
        },
        {
          ...base,
          policyCode : 'disabled',
          identifier : 'security.user.delete.global',
          active     : false,
        },
        {
          ...base,
          workspace  : 'elsewhere',
          policyCode : 'other',
          identifier : 'security.user.update.global',
          active     : true,
        },
      ]);
      repositories.authentication =
        require('../server/modules/session/repositories/session-authentication.repository').sessionAuthenticationRepository(
          {
            session   : models.session,
            user      : models.user,
            workspace : models.workspaces,
            group     : models.group,
            policy    : models.policy,
            messaging,
          },
        );
      const jwt         = require('jsonwebtoken');
      const tokenSecret = 'isolated-authentication-fixture';
      const token       = jwt.sign({ user: { userCode: 'u' } }, tokenSecret, { expiresIn: 3600 });
      await models.session.collection.updateOne({ sessionCode: 's' }, { $set: { token } });
      const scopes = {};
      for (const resource of ['user', 'session', 'group', 'policy', 'workspaces'])
        scopes[resource + 'Scopes'] = require(
          '../server/modules/' + resource + '/policies/' + resource + '.policy',
        ).trustedScopes;
      const authentication =
        require('../server/modules/session/services/session-authorization-workflow.service').sessionAuthorizationWorkflowService(
          {
            ...scopes,
            ApplicationError  : require('../server/shared/application-error').ApplicationError,
            dependencies      : {
              tokenSecret,
              repositories,
            },
            jwt,
            tokenContexts     : { session: {} },
            sessionRepository : repositories.session,
            /** @returns {Object} Usa el puerto de persistencia real para las lecturas del usuario. */
            userService() {
              return repositories.user;
            },
            /** @returns {Object} Usa el puerto de persistencia real para las lecturas del workspace. */
            workspacesService() {
              return repositories.workspaces;
            },
            logger            : { /** @returns {void} No exporta credenciales sintéticas. */ error() {} },
          },
        );
      /** @returns {Promise<Object>} Cada request vuelve a leer todas las dependencias obligatorias. */
      const authenticate   = () =>
        authentication.authenticate({
          token,
          currentPolicies : true,
        });
      assert.deepEqual((await authenticate()).policies, [
        'security.user.view.workspace',
        'security.user.update.global',
      ]);
      const commands = [];
      /** @param {Object} event Metadatos de comando local, sin conservar su contenido. @returns {void} Cuenta sólo el coste de la consulta. */
      function countCommand(event) {
        commands.push(event.commandName);
      }
      connection.getClient().on('commandStarted', countCommand);
      await authenticate();
      connection.getClient().off('commandStarted', countCommand);
      assert.deepEqual(commands, ['aggregate']);
      assert.equal(
        JSON.stringify(
          await repositories.authentication.read({
            token,
            userCode        : 'u',
            now             : Date.now(),
            currentPolicies : true,
          }),
        ).includes('must-not-leak'),
        false,
      );
      await readSnapshot({
        mongoose,
        connection,
      })(authenticate);
      for (const [resource, filter, changes] of [
        ['user', { userCode: 'u' }, { state: 'registered' }],
        ['user', { userCode: 'u' }, { erased: true }],
        ['user', { userCode: 'u' }, { validity: 1 }],
        ['user', { userCode: 'u' }, { credentialsChangedAt: 1 }],
        ['user', { userCode: 'u' }, { userType: 'agent' }],
        ['user', { userCode: 'u' }, { userType: 'external' }],
        ['session', { sessionCode: 's' }, { expiration: 1 }],
        ['session', { sessionCode: 's' }, { workspaces: [] }],
        ['session', { sessionCode: 's' }, { activeWorkspace: 'missing' }],
        ['workspaces', { workspaceCode: 'w' }, { erased: true }],
      ]) {
        const original = await models[resource].collection.findOne(filter);
        await models[resource].collection.updateOne(filter, { $set: changes });
        try {
          await assert.rejects(authenticate(), { statusCode: 401 });
        } finally {
          await models[resource].collection.replaceOne(filter, original);
        }
      }
      for (const groups of [[], 'g', [null, '', 1]]) {
        await models.user.collection.updateOne({ userCode: 'u' }, { $set: { groups } });
        assert.deepEqual((await authenticate()).policies, []);
      }
      await models.user.collection.updateOne({ userCode: 'u' }, { $set: { groups: ['g'] } });
      const controller = identityController({
        messaging,
        authorization :
          require('../server/modules/identity/repositories/identity-authorization.repository').identityAuthorizationRepository(
            {
              session   : models.session,
              user      : models.user,
              workspace : models.workspaces,
              messaging,
            },
          ),
        users         : repositories.user,
        sessions      : repositories.session,
        groups        : repositories.group,
        policies      : repositories.policy,
        workspaces    : repositories.workspaces,
      });
      const [action]   = catalog([
        {
          name    : 'session-own-access-get',
          kind    : 'action',
          handler : controller.ownAccess,
        },
      ]);
      const snapshot   = readSnapshot({
        mongoose,
        connection,
      });
      /** @param {Object} [data] Consulta vacía o entrada hostil. @param {string} [originService] Origen acreditado. @returns {Promise<Object>} Lectura canónica con snapshot. */
      const read       = (data = {}, originService = 'service-platform') =>
        snapshot(
          /** @returns {Promise<Object>} Ejecuta el controlador dentro de una única instantánea. */
          () =>
            action.handler({
              data,
              originService,
            }),
        );
      const before     = await models.session.collection.findOne({ sessionCode: 's' });
      const first      = (await read()).data;
      assert.deepEqual(first.policies, ['security.user.view.workspace']);
      assert.deepEqual(first.groups, ['g']);
      assert.deepEqual(first.workspaces, [
        {
          workspaceCode : 'new',
          name          : 'New workspace',
        },
        {
          workspaceCode : 'w',
          name          : 'Workspace',
        },
      ]);
      assert.deepEqual(Object.keys(first).sort(), [
        'expiration',
        'groups',
        'policies',
        'sessionCode',
        'userCode',
        'workspace',
        'workspaces',
      ]);
      await models.policy.collection.updateOne({ policyCode: 'p' }, { $set: { active: false } });
      assert.deepEqual((await read()).data.policies, []);
      assert.deepEqual((await authenticate()).policies, ['security.user.update.global']);
      assert.deepEqual(await models.session.collection.findOne({ sessionCode: 's' }), before);
      await assert.rejects(read({ userCode: 'other' }), { statusCode: 400 });
      await assert.rejects(read({}, 'service-connect'), { statusCode: 403 });
      context.delegation = { grantCode: 'grant' };
      await assert.rejects(read(), { statusCode: 403 });
      delete context.delegation;
      await models.user.collection.updateOne({ userCode: 'u' }, { $set: { workspaces: ['new'] } });
      await assert.rejects(read(), { statusCode: 403 });
      await assert.rejects(authenticate(), { statusCode: 401 });
      await models.user.collection.updateOne({ userCode: 'u' }, { $set: { workspaces: ['w'] } });
      await models.session.collection.updateOne({ sessionCode: 's' }, { $set: { active: false } });
      await assert.rejects(read(), { statusCode: 401 });
      await assert.rejects(authenticate(), { statusCode: 401 });
    } finally {
      await mongo.stop();
    }
  },
);
