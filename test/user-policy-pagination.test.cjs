/** @file Compatibilidad canónica de usuarios por política con múltiples consumidores y paginación completa de grupos y destinatarios. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const { ApplicationError }   = require('../server/shared/application-error');
const utilities              = require('../server/shared/general');
const userPolicy             = require('../server/modules/user/policies/user.policy');
const groupPolicy            = require('../server/modules/group/policies/group.policy');
const policyPolicy           = require('../server/modules/policy/policies/policy.policy');
const { userQueriesService } = require('../server/modules/user/services/user-queries.service');
const createController       = require('../server/modules/user/controllers/user.controller');
const { actionDtos }         = require('../server/contracts');

/**
 * Comprueba todas las páginas con el mismo contrato, sin una consulta especial para Platform.
 * @returns {Promise<void>} Finaliza al acreditar que no se pierden grupos ni usuarios después de cien elementos.
 */
async function verifyPolicyPagination() {
  const groups = [];
  const users  = [];
  for (let index = 0; index < 121; index++) groups.push({ groupCode: `g${index}` });
  for (let index = 0; index < 231; index++)
    users.push({
      userCode : `u${index}`,
      password : 'private-fixture',
    });
  const queries = [];
  /** @returns {Object} Contexto canónico con el mismo permiso para todos los emisores acreditados. */
  function getContext() {
    return {
      user      : { userCode: 'admin' },
      policies  : ['security.user.view.global'],
      workspace : 'w',
    };
  }
  /** @param {number} statusCode Estado público producido por el controlador.
   * @param {*} data Datos del recurso ya presentados.
   * @returns {Object} Sobre compatible con mensajería, sin conectar un transporte.
   */
  function successResponse(statusCode, data) {
    return {
      statusCode,
      descriptionCode : 'OK',
      data,
    };
  }
  /** @param {Object} query Página pública solicitada por el caso de uso.
   * @returns {Promise<Object>} Página de grupos estable y completa.
   */
  async function listGroups(query) {
    return {
      pagination : {
        total   : groups.length,
        page    : query.page,
        perPage : query.perPage,
      },
      items      : groups.slice((query.page - 1) * query.perPage, query.page * query.perPage),
    };
  }
  /** @returns {Object} Capacidad mínima de lectura de grupos. */
  function groupService() {
    return { getList: listGroups };
  }
  /** @returns {Promise<Object>} Política cuyo código selecciona los grupos correspondientes. */
  async function getPolicy() {
    return { policyCode: 'p' };
  }
  /** @returns {Object} Capacidad mínima de lectura de una política. */
  function policyService() {
    return { getOne: getPolicy };
  }
  /**
   * Lee usuarios con el mismo filtro autorizado y paginación interna desde cero.
   * @param {Object} filter Condición del dominio y restricciones de acceso.
   * @param {Object} sort Orden estable por código.
   * @param {number} page Página interna desde cero.
   * @param {number} perPage Cantidad solicitada para esta página.
   * @returns {Promise<Object>} Página de registros simples y conteo completo.
   */
  async function getList(filter, sort, page, perPage) {
    assert.equal(filter.$and[1].groups.$in.length, groups.length);
    assert.deepEqual(sort, { userCode: 'asc' });
    queries.push({
      page,
      perPage,
    });
    return {
      listItem   : users.slice(page * perPage, (page + 1) * perPage),
      totalCount : users.length,
    };
  }
  const messaging = {
    getContext,
    successResponse,
  };
  /**
   * Construye el mismo caso de uso de consulta para cada solicitud independiente.
   * @returns {Object} Operaciones de consulta sin repositorios ni SDK concretos.
   */
  function userService() {
    return userQueriesService({
      ApplicationError,
      utilities,
      messaging,
      userPolicy,
      policyService,
      groupService,
      userRepository : { getList },
      userState      : {},
      dependencies   : {},
      groupScopes    : groupPolicy.trustedScopes,
      policyScopes   : policyPolicy.trustedScopes,
      userScopes     : userPolicy.trustedScopes,
    });
  }
  const controller = createController({
    messaging,
    services : { user: userService },
  });
  const dto        = actionDtos['user-get-policy'];
  for (const originService of ['service-platform', 'service-directory', 'service-intelligence']) {
    /** @param {Object} pagination Página pública que usaría cualquier consumidor del recurso.
     * @returns {Promise<Object>} Datos de la respuesta acreditados por ambos DTO de transporte.
     */
    async function readPage(pagination) {
      const data = dto.input({
        identifier : 'security.user.view.workspace',
        ...pagination,
      });
      return dto.output(
        await controller.getByPolicy({
          originService,
          data,
        }),
      ).data;
    }
    const result = await utilities.collectPages(readPage);
    assert.equal(result.items.length, users.length);
    assert.equal(result.items[230].userCode, 'u230');
    assert.equal(JSON.stringify(result).includes('private-fixture'), false);
  }
  assert.deepEqual(queries, [
    {
      page    : 0,
      perPage : 100,
    },
    {
      page    : 1,
      perPage : 100,
    },
    {
      page    : 2,
      perPage : 100,
    },
    {
      page    : 0,
      perPage : 100,
    },
    {
      page    : 1,
      perPage : 100,
    },
    {
      page    : 2,
      perPage : 100,
    },
    {
      page    : 0,
      perPage : 100,
    },
    {
      page    : 1,
      perPage : 100,
    },
    {
      page    : 2,
      perPage : 100,
    },
  ]);
}

test(
  'usuarios por política recorre todos los grupos y páginas con idéntico contrato para cada consumidor',
  verifyPolicyPagination,
);
