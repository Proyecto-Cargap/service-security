/** @file Regresión con MongoDB aislado: elimina workspaces sin referencias vigentes y conserva las bajas y sesiones históricas. */
'use strict';
const test                       = require('node:test');
const assert                     = require('node:assert/strict');
const { startIsolatedMongo }     = require('./helpers/isolated-mongo.cjs');
const createWorkspacesRepository = require('../server/modules/workspaces/repositories/workspaces.repository');
const createWorkspacesService    = require('../server/modules/workspaces/services/workspaces.service');

/**
 * Recorre la baja real con políticas, repositorio y esquemas del servicio, sin conexiones remotas.
 * @param {import('node:test').TestContext} context Registro de casos y cierre del MongoDB temporal.
 * @returns {Promise<void>} Comprueba bloqueos válidos y descarta referencias históricas sin borrarlas.
 */
async function verifyWorkspaceDeletion(context) {
  const mongoose = require('mongoose');
  const database = await startIsolatedMongo({
    binary : process.env.TEST_MONGOD_BINARY,
    mongoose,
  });
  context.after(database.stop);
  const modules = {
    workspaces : require('../server/modules/workspaces/models/workspaces.model'),
    user       : require('../server/modules/user/models/user.model'),
    session    : require('../server/modules/session/models/session.model'),
    group      : require('../server/modules/group/models/group.model'),
    policy     : require('../server/modules/policy/models/policy.model'),
  };
  const models  = {};
  for (const [name, model] of Object.entries(modules)) {
    const schema = model.schema.clone();
    schema.set('autoCreate', false);
    models[name] = database.connection.model(
      `WorkspaceReference${name}`,
      schema,
      `reference_${name}`,
    );
    await models[name].createCollection();
  }
  const workspaceCode = 'workspace-to-delete';
  const effects       = [];
  const messaging     = {
    /** @param {string} name Evento. @param {Object} data Referencia. @param {Object} options Sesión productora. @returns {Promise<Object>} Outbox aislado en la misma transacción. */
    publishEvent(name, data, options) {
      return database.connection.db.collection('TEST_OUTBOX').insertOne(
        {
          name,
          data,
        },
        options,
      );
    },

    /** @returns {Object} Identidad administrativa local autorizada por la política real. */
    getContext() {
      return {
        user      : { userCode: 'fixture-user' },
        workspace : 'other-workspace',
        policies  : ['security.workspaces.delete.global'],
      };
    },
    /** @returns {Promise<void>} Registra el aviso sin contactar a Platform. */
    async sendCommand() {
      effects.push('notice');
    },
  };
  const repository    = createWorkspacesRepository({
    model        : models.workspaces,
    userModel    : models.user,
    sessionModel : models.session,
    groupModel   : models.group,
    policyModel  : models.policy,
    messaging,
  });
  const session       = {
    workspace       : 'allWorkspaces',
    activeWorkspace : workspaceCode,
    workspaces      : [workspaceCode, 'other-workspace'],
    active          : true,
    expiration      : Date.now() / 1000 + 3600,
    erased          : false,
  };
  const cases         = [
    {
      label    : 'cuatro sesiones con permisos anteriores y otro workspace activo no bloquean la baja',
      resource : 'session',
      records  : Array.from(
        { length: 4 },
        /** @returns {Object} Instantánea local equivalente a una sesión con membresías anteriores. */
        () => ({
          ...session,
          activeWorkspace : 'other-workspace',
        }),
      ),
      blocked  : false,
    },
    {
      label    : 'un usuario borrado no bloquea',
      resource : 'user',
      records  : [
        {
          workspaces : [workspaceCode],
          erased     : true,
        },
      ],
      blocked  : false,
    },
    {
      label    : 'un perfil borrado no bloquea',
      resource : 'group',
      records  : [
        {
          workspace : workspaceCode,
          erased    : true,
        },
      ],
      blocked  : false,
    },
    {
      label    : 'una política borrada no bloquea',
      resource : 'policy',
      records  : [
        {
          workspace : workspaceCode,
          erased    : true,
        },
      ],
      blocked  : false,
    },
    {
      label    : 'una sesión cerrada no bloquea',
      resource : 'session',
      records  : [
        {
          ...session,
          active : false,
        },
      ],
      blocked  : false,
    },
    {
      label    : 'una sesión vencida no bloquea',
      resource : 'session',
      records  : [
        {
          ...session,
          expiration : Date.now() / 1000 - 60,
        },
      ],
      blocked  : false,
    },
    {
      label    : 'una sesión borrada no bloquea',
      resource : 'session',
      records  : [
        {
          ...session,
          erased : true,
        },
      ],
      blocked  : false,
    },
    {
      label    : 'una sesión vigente usando el workspace bloquea',
      resource : 'session',
      records  : [session],
      blocked  : true,
    },
    {
      label    : 'una sesión vigente perteneciente al workspace bloquea',
      resource : 'session',
      records  : [
        {
          ...session,
          workspace       : workspaceCode,
          activeWorkspace : 'other-workspace',
        },
      ],
      blocked  : true,
    },
    {
      label    : 'un usuario inactivo con membresía vigente bloquea',
      resource : 'user',
      records  : [
        {
          workspaces : [workspaceCode],
          state      : 'inactive',
          erased     : false,
        },
      ],
      blocked  : true,
    },
    {
      label    : 'un usuario perteneciente al workspace bloquea',
      resource : 'user',
      records  : [
        {
          workspace : workspaceCode,
          erased    : false,
        },
      ],
      blocked  : true,
    },
    {
      label    : 'un perfil vigente bloquea',
      resource : 'group',
      records  : [
        {
          workspace : workspaceCode,
          erased    : false,
        },
      ],
      blocked  : true,
    },
    {
      label    : 'una política inactiva sin borrar bloquea',
      resource : 'policy',
      records  : [
        {
          workspace : workspaceCode,
          active    : false,
          erased    : false,
        },
      ],
      blocked  : true,
    },
    {
      label    : 'una referencia sin marca de borrado bloquea',
      resource : 'user',
      records  : [{ workspaces: [workspaceCode] }],
      blocked  : true,
    },
    {
      label    : 'referencias a otro workspace no bloquean',
      resource : 'user',
      records  : [
        {
          workspaces : ['other-workspace'],
          erased     : false,
        },
      ],
      blocked  : false,
    },
  ];
  for (const scenario of cases)
    await context.test(
      scenario.label,
      /**
       * Ejecuta una baja contra MongoDB y verifica que sólo se borre el workspace autorizado.
       * @returns {Promise<void>} Acredita el resultado y conserva los registros relacionados.
       */
      async () => {
        for (const model of Object.values(models)) await model.collection.deleteMany({});
        effects.length = 0;
        await database.connection.db.collection('TEST_OUTBOX').deleteMany({});
        await models.workspaces.collection.insertOne({
          workspaceCode,
          workspace    : 'allWorkspaces',
          name         : 'Workspace de prueba',
          userCreate   : 'fixture-user',
          userAssigned : '',
          erased       : false,
        });
        await models[scenario.resource].collection.insertMany(scenario.records);
        const before  = await models[scenario.resource].collection.find({}).toArray();
        const service = createWorkspacesService({
          messaging,
          repositories      : { workspaces: repository },
          workspacePictures : {
            /** @returns {Promise<boolean>} Confirma la limpieza simulada sin almacenamiento externo. */
            async remove() {
              effects.push('picture');
              return true;
            },
          },
        });
        const removal = service.delete({ workspaceCode });
        if (scenario.blocked) {
          await assert.rejects(removal, {
            statusCode      : 409,
            descriptionCode : 'WORKSPACES_IN_USE',
          });
          assert.equal(await models.workspaces.countDocuments({ workspaceCode }), 1);
          assert.deepEqual(effects, []);
        } else {
          assert.equal((await removal).workspaceCode, workspaceCode);
          assert.equal(await models.workspaces.countDocuments({ workspaceCode }), 0);
          assert.deepEqual(effects, []);
          const event = await database.connection.db
            .collection('TEST_OUTBOX')
            .findOne({ name: 'security.access.changed' });
          assert.equal(event.data.resource, 'workspace');
          assert.equal(event.data.code, workspaceCode);
          assert.equal(await database.connection.db.collection('TEST_OUTBOX').countDocuments(), 1);
        }
        assert.deepEqual(await models[scenario.resource].collection.find({}).toArray(), before);
      },
    );
}

test(
  'la eliminación de workspaces usa referencias actuales y preserva el historial',
  {
    skip    : !process.env.TEST_MONGOD_BINARY,
    timeout : 60000,
  },
  verifyWorkspaceDeletion,
);
