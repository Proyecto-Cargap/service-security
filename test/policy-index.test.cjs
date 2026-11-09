/** @file Comprueba el catálogo real de servicios de políticas a través del caso de uso, controlador y DTO RPC. */
'use strict';
const test                    = require('node:test');
const assert                  = require('node:assert/strict');
const { catalog, actionDtos } = require('../server/contracts');
const { ApplicationError }    = require('../server/shared/application-error');
const createController        = require('../server/modules/policy/controllers/policy.controller');
const {
  policyQueriesWorkflowService,
} = require('../server/modules/policy/services/policy-queries-workflow.service');

/**
 * Recorre la salida real de la consulta y la validación que antes convertía el éxito en HTTP 500.
 * @returns {Promise<void>} Acredita catálogos con datos, vacíos y errores de autorización.
 */
async function verifyPolicyIndex() {
  let services = ['security', 'directory'];
  let failure;
  const requests = [];
  /**
   * Representa el puerto autorizado de persistencia sin abrir conexiones.
   * @param {string} field Campo distinto solicitado por la aplicación.
   * @param {Object} filter Condición construida por el caso de uso.
   * @returns {Promise<string[]>} Nombres visibles para el contexto de prueba.
   * @throws {ApplicationError} Propaga una denegación explícita del repositorio.
   */
  async function getDistinct(field, filter) {
    requests.push({
      field,
      filter,
    });
    if (failure) throw failure;
    return services;
  }
  /**
   * Construye el caso de uso real con el puerto mínimo de consulta.
   * @returns {Object} Operaciones de aplicación con estado independiente por solicitud.
   */
  function policyService() {
    return policyQueriesWorkflowService({
      ApplicationError,
      policyRepository : { getDistinct },
      policyState      : {},
    });
  }
  /**
   * Conserva el sobre RPC producido por el controlador antes de aplicar el DTO de salida.
   * @param {number} statusCode Estado público de la operación.
   * @param {Object} data Catálogo con la propiedad items.
   * @returns {Object} Respuesta que atraviesa la frontera real del catálogo RPC.
   */
  function successResponse(statusCode, data) {
    return {
      statusCode,
      descriptionCode : 'OK',
      data,
    };
  }
  const controller = createController({
    messaging : { successResponse },
    services  : { policy: policyService },
  });
  const [action]   = catalog([
    {
      name    : 'policy-get-index',
      kind    : 'action',
      handler : controller.getIndex,
    },
  ]);
  for (const names of [['security', 'directory'], []]) {
    services = names;
    const response = await action.handler({ data: {} });
    assert.deepEqual(response, {
      statusCode      : 200,
      descriptionCode : 'OK',
      data            : { items: names },
    });
  }
  assert.deepEqual(requests[0], {
    field  : 'service',
    filter : { $and: [{ identifier: { $ne: '' } }] },
  });
  failure = new ApplicationError(403, 'FORBIDDEN');
  await assert.rejects(action.handler({ data: {} }), { statusCode: 403 });
}

/**
 * Rechaza respuestas distintas del objeto público con un arreglo de nombres.
 * @returns {void} Comprueba que el DTO no convierte datos inválidos en un catálogo vacío.
 */
function verifyInvalidPolicyIndex() {
  const dto = actionDtos['policy-get-index'];
  for (const data of [
    [],
    ['security'],
    {},
    { items: null },
    { items: [42] },
    {
      items   : [],
      private : true,
    },
  ]) {
    /**
     * Envía una salida inválida a la misma validación aplicada en mensajería.
     * @returns {Object} Respuesta únicamente si el DTO permitiera datos inválidos.
     * @throws {ApplicationError} Debe rechazar el formato con estado 500.
     */
    function invalidResponse() {
      return dto.output({
        statusCode : 200,
        data,
      });
    }
    assert.throws(invalidResponse, { statusCode: 500 });
  }
}

test(
  'policy-get-index conserva el objeto items a través de aplicación, controlador y DTO',
  verifyPolicyIndex,
);
test('policy-get-index rechaza salidas ajenas al catálogo público', verifyInvalidPolicyIndex);
