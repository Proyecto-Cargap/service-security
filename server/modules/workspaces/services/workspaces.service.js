/**
 * @file Operaciones de aplicación de espacios de trabajo. Coordina las validaciones y las colaboraciones
 * necesarias para cada solicitud.
 * Cada caso de uso devuelve sus datos o propaga ApplicationError con un código público estable.
 */

'use strict';
const { workspacesPresenter } = require('../presenters/workspaces.presenter');

const workspacesPolicy                    = require('../policies/workspaces.policy');
const { trustedScopes: workspacesScopes } = workspacesPolicy;
/**
 * Construye una instancia de WorkspacesService con dependencias y estado propios de la solicitud.
 *
 * @param {Object} dependencies Mensajería, contador y logger opcional; permite inyectar el repositorio o modelo de espacios de trabajo.
 * @returns {Object} Instancia de WorkspacesService; construirla no ejecuta operaciones de persistencia.
 */
module.exports = function workspacesService(dependencies) {
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
  const workspacesRepository = dependencies.repositories.workspaces;
  const pictures             = dependencies.workspacePictures;
  /**
   * Compone la recuperación de una carga cuyo resultado quedó incierto.
   * @param {*} record Valor de record utilizado por esta operación.
   * @returns {Promise<void>} Finaliza cuando se completan los efectos de la operación.
   */
  const { recoverUpload }    =
    require('../services/workspace-picture-recovery.service').workspacePictureRecoveryService({
      logger,
      pictures,
      workspacesRepository,
      workspacesScopes,
    });
  /**
   * Ejecuta recoverUpload dentro del flujo de workspaces.service.
   * @param {*} uploaded Valor de uploaded utilizado por esta operación.
   * @param {*} resourceCode Valor de resourceCode utilizado por esta operación.
   * @param {Error} error Fallo recibido por la continuación.
   * @returns {Promise<boolean>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */

  const controller      = 'C001';
  const workspacesState = { document: null };
  const maintenance     =
    require('./workspaces-maintenance-workflow.service').workspacesMaintenanceWorkflowService({
      ApplicationError,
      controller,
      counter,
      id,
      logger,
      messaging,

      pictures,
      recoverUpload,
      workspacesPolicy,
      workspacesPresenter,
      workspacesRepository,
      workspacesScopes,
      workspacesState,
    });
  const queries         = require('./workspaces-queries-workflow.service').workspacesQueriesWorkflowService(
    {
      ApplicationError,
      logger,
      utilities,
      workspacesRepository,
      workspacesState,
    },
  );
  return {
    ...maintenance,
    ...queries,
  };
};
