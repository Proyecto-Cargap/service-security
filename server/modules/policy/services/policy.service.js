/**
 * @file Operaciones de aplicación de políticas de acceso. Coordina las validaciones y las colaboraciones
 * necesarias para cada solicitud.
 * Cada caso de uso devuelve sus datos o propaga ApplicationError con un código público estable.
 */

'use strict';
const { policyPresenter } = require('../presenters/policy.presenter');

const policyPolicy                    = require('../policies/policy.policy');
// CRUD conserva su contrato; las capacidades de ejecución sólo admiten los destinos registrados.
const POLICY_IDENTIFIER               =
  /^(?:[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*\.(?:create|view|update|delete)\.(?:global|workspace|owner|assigned)|intelligence\.(?:agent\.invoke|tool\.execute)\.(?:global|workspace))$/;
const { trustedScopes: policyScopes } = policyPolicy;
/**
 * Construye una instancia de PolicyService con dependencias y estado propios de la solicitud.
 *
 * @param {Object} dependencies Mensajería, contador y logger opcional; permite inyectar el repositorio o modelo de políticas.
 * @returns {Object} Instancia de PolicyService; construirla no ejecuta operaciones de persistencia.
 */
module.exports = function policyService(dependencies) {
  const { ApplicationError } = require('../../../shared/application-error');
  const messaging            = dependencies.messaging;
  const logger               = dependencies.logger || {
    /**
     * Ofrece el punto de extensión error sin efectos por defecto.
     * @returns {void} Finaliza después de aplicar los efectos de la operación.
     */
    error() {},
  };
  const counter              = dependencies.counter;
  const utilities            = require('../../../shared/general');
  const { id }               = require('../../../../package.json');
  const policyRepository     = dependencies.repositories.policy;
  const controller           = 'C001';
  const policyState          = { document: null };
  const maintenance          =
    require('./policy-maintenance-workflow.service').policyMaintenanceWorkflowService({
      ApplicationError,
      POLICY_IDENTIFIER,
      controller,
      counter,
      id,
      logger,
      messaging,

      policyPolicy,
      policyPresenter,
      policyRepository,
      policyScopes,
      policyState,
    });
  const queries              = require('./policy-queries-workflow.service').policyQueriesWorkflowService({
    ApplicationError,
    logger,
    policyRepository,
    policyState,
    utilities,
  });
  return {
    ...maintenance,
    ...queries,
  };
};
