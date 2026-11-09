/**
 * @file Operaciones de aplicación de grupos. Coordina las validaciones y las colaboraciones necesarias
 * para cada solicitud.
 * Cada caso de uso devuelve sus datos o propaga ApplicationError con un código público estable.
 */

'use strict';

const groupPolicy                    = require('../policies/group.policy');
const { trustedScopes: groupScopes } = groupPolicy;

/**
 * Construye una instancia de GroupService con dependencias y estado propios de la solicitud.
 *
 * @param {Object} dependencies Mensajería, contador y logger opcional; recibe repositorio de grupos y fábricas de políticas ya compuestas.
 * @returns {Object} Instancia de GroupService; construirla no ejecuta operaciones de persistencia.
 */
module.exports = function groupService(dependencies) {
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
  const groupRepository      = dependencies.repositories.group;
  const policyService        = dependencies.services?.policy;
  const controller           = 'C001';
  /**
   * Delega la lectura mínima de una política sin construir un servicio relacionado hasta necesitarlo.
   * @param {Object} filter Condición autorizada del dominio para una nueva asociación.
   * @returns {Promise<Object|null>} Política visible o ausencia; conserva los errores del caso de consulta.
   */
  function readPolicy(filter) {
    return policyService(dependencies).getOne(filter);
  }
  /**
   * Ejecuta validName dentro del flujo de group.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  const { validName, validPolicies } =
    require('../services/group-validation.service').groupValidationService({
      ApplicationError,
      readPolicy,
    });
  /**
   * Ejecuta validPolicies dentro del flujo de group.service.
   * @param {*} value Valor de value utilizado por esta operación.
   * @param {*} [previous] Valor de previous utilizado por esta operación.
   * @returns {Promise<Array<*>>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */

  const groupState  = { document: null };
  const maintenance =
    require('./group-maintenance-workflow.service').groupMaintenanceWorkflowService({
      ApplicationError,
      controller,
      counter,
      groupPolicy,
      groupRepository,
      groupScopes,
      groupState,
      id,
      logger,
      messaging,

      validName,
      validPolicies,
      roleDefaults : dependencies.roleDefaults,
    });
  const queries     = require('./group-queries-workflow.service').groupQueriesWorkflowService({
    ApplicationError,
    groupRepository,
    groupState,
    logger,
    utilities,
  });
  const memberships =
    require('./group-memberships-workflow.service').groupMembershipsWorkflowService({
      ApplicationError,
      groupPolicy,
      groupRepository,
      groupScopes,
      groupState,
      logger,
      messaging,

      validPolicies,
    });
  return {
    ...maintenance,
    ...queries,
    ...memberships,
  };
};
