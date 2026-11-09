/** @file Casos de uso de mantenimiento del recurso workspaces; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de mantenimiento con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function workspacesMaintenanceWorkflowService({
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
}) {
  return {
    /**
     * Prepara los datos de espacios de trabajo y coordina la creación del registro y sus operaciones
     * asociadas.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de espacios de trabajo que utiliza name.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async create(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      let uploadedPicture;
      let pictureResourceCode;
      try {
        for (const key of ['description', 'picture'])
          if (data[key] !== undefined && typeof data[key] !== 'string')
            throw new ApplicationError(400, 'INVALID_WORKSPACE_PRESENTATION');
        if (
          data.picture?.trim() &&
          !/^\/files\/public\/v1\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
            data.picture.trim(),
          )
        ) {
          let picture;
          try {
            picture = new URL(data.picture.trim());
          } catch {
            throw new ApplicationError(400, 'INVALID_WORKSPACE_PICTURE');
          }
          if (!['http:', 'https:'].includes(picture.protocol))
            throw new ApplicationError(400, 'INVALID_WORKSPACE_PICTURE');
        }
        const system = messaging.getContext();
        if (typeof data.name !== 'string' || !data.name.trim()) {
          throw new ApplicationError(400, `${id}-${controller}-E0001:Name is required`);
        }
        data.name = data.name.trim();
        const requestedScope     = data.scope === undefined ? '' : data.scope;
        const authorizedCreation = workspacesPolicy.authorize(
          'create',
          data,
          requestedScope,
          system,
        );
        if (!authorizedCreation) throw new ApplicationError(403, 'FORBIDDEN');
        if (
          await workspacesRepository.getOne(
            {
              name : data.name,
            },
            workspacesScopes.guest,
          )
        ) {
          throw new ApplicationError(409, `${id}-${controller}-E0002:Workspaces exist`);
        }
        const body = {
          workspaceCode : await counter.getObjectCode('WSP'),
          name          : data.name,
          description   : typeof data.description === 'string' ? data.description.trim() : '',
          picture       : typeof data.picture === 'string' ? data.picture : '',
          workspace     : data.workspace,
          userAssigned  : data.userAssigned,
          idTransaction : system.idTransaction,
        };
        if (data.pictureUpload) {
          pictureResourceCode = body.workspaceCode;
          uploadedPicture = await pictures.upload(
            data.pictureUpload,
            body.workspaceCode,
            authorizedCreation.workspace,
          );
          Object.assign(body, uploadedPicture);
        }
        workspacesState.document = await workspacesRepository.create(body, requestedScope);
        effectsCompleted = true;

        return workspacesState.document;
      } catch (err) {
        if (uploadedPicture && !effectsCompleted)
          effectsCompleted = await recoverUpload(uploadedPicture, pictureResourceCode, err);
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) {
          if (effectsCompleted) err.uncertain = true;
          throw err;
        }
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(
          err.statusCode || 500,
          `${id}-${controller}-E0000:Error system`,
          {
            cause     : err,
            uncertain : effectsCompleted || err?.uncertain === true,
          },
        );
      }
    },
    /**
     * Localiza el registro de espacios de trabajo, aplica los cambios admitidos por esta operación y los
     * persiste.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {Object} data Datos de espacios de trabajo que utiliza name, description, picture.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async update(condition, data) {
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      let uploadedPicture;
      let pictureResourceCode;
      try {
        for (const key of ['description', 'picture'])
          if (data[key] !== undefined && typeof data[key] !== 'string')
            throw new ApplicationError(400, 'INVALID_WORKSPACE_PRESENTATION');
        if (
          data.picture?.trim() &&
          !/^\/files\/public\/v1\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
            data.picture.trim(),
          )
        ) {
          let picture;
          try {
            picture = new URL(data.picture.trim());
          } catch {
            throw new ApplicationError(400, 'INVALID_WORKSPACE_PICTURE');
          }
          if (!['http:', 'https:'].includes(picture.protocol))
            throw new ApplicationError(400, 'INVALID_WORKSPACE_PICTURE');
        }
        workspacesState.document = null;
        const requestedScope   = data.scope === undefined ? '' : data.scope;
        const authorizedFilter = workspacesPolicy.authorize('update', condition, requestedScope, {
          ...messaging.getContext(),
          changes : data,
        });
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        workspacesState.document = await workspacesRepository.getOne(
          authorizedFilter,
          workspacesScopes.guest,
        );
        if (!workspacesState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0003:Workspaces code is required`);
        }
        const previousPictureId = workspacesState.document.pictureFile?.id || '';
        const previousPicture   = workspacesState.document.picture;
        pictureResourceCode = workspacesState.document.workspaceCode;
        for (const field of ['workspace', 'userAssigned']) {
          if (Object.hasOwn(data, field)) workspacesState.document[field] = data[field];
        }
        if (data.name != undefined) {
          if (typeof data.name !== 'string' || !data.name.trim())
            throw new ApplicationError(400, 'INVALID_NAME');
          const name = data.name.trim();
          if (
            name !== workspacesState.document.name &&
            (await workspacesRepository.getOne(
              {
                name,
                workspaceCode : { $ne: workspacesState.document.workspaceCode },
              },
              workspacesScopes.guest,
            ))
          )
            throw new ApplicationError(409, 'WORKSPACE_NAME_EXISTS');
          workspacesState.document.name = name;
        }
        if (data.description != undefined) {
          workspacesState.document.description = data.description.trim();
        }
        if (data.picture != undefined) {
          workspacesState.document.picture = data.picture;
        }
        if (data.pictureUpload) {
          uploadedPicture = await pictures.upload(
            data.pictureUpload,
            pictureResourceCode,
            workspacesState.document.workspace,
          );
          Object.assign(workspacesState.document, uploadedPicture);
        } else if (data.picture !== undefined && data.picture !== previousPicture) {
          workspacesState.document.pictureFile = null;
        }
        if (previousPictureId && (uploadedPicture || !workspacesState.document.pictureFile))
          workspacesState.document.pictureCleanup = [
            ...new Set([...(workspacesState.document.pictureCleanup || []), previousPictureId]),
          ];
        workspacesState.document = await workspacesRepository.updateItem(
          workspacesState.document,
          requestedScope,
          'update',
          previousPictureId,
        );
        effectsCompleted = true;

        return workspacesState.document;
      } catch (err) {
        if (uploadedPicture && !effectsCompleted)
          effectsCompleted = await recoverUpload(uploadedPicture, pictureResourceCode, err);
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) {
          if (effectsCompleted) err.uncertain = true;
          throw err;
        }
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
          cause     : err,
          uncertain : effectsCompleted || err?.uncertain === true,
        });
      }
    },
    /**
     * Localiza y elimina el registro de espacios de trabajo y coordina las operaciones asociadas presentes en
     * este flujo.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async delete(condition, scope = '') {
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');
      {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition))
          throw new ApplicationError(400, 'INVALID_FILTER');
      }
      let effectsCompleted = false;
      try {
        workspacesState.document = null;
        const filter = workspacesPolicy.authorize(
          'delete',
          condition,
          scope,
          messaging.getContext(),
        );
        if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
        const record = await workspacesRepository.getOne(filter, workspacesScopes.guest);
        if (!record) throw new ApplicationError(404, 'NOT_FOUND');
        if (await workspacesRepository.hasReferences(record.workspaceCode))
          throw new ApplicationError(409, 'WORKSPACES_IN_USE');
        workspacesState.document = await workspacesRepository.deleteOne(condition, false, scope);
        effectsCompleted = true;
        if (!workspacesState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0003:Workspace code is required`);
        }

        return workspacesState.document;
      } catch (err) {
        if (err?.code === 11000) throw new ApplicationError(409, 'DUPLICATE_SECURITY_RECORD');
        if (err instanceof ApplicationError) {
          if (effectsCompleted) err.uncertain = true;
          throw err;
        }
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(err.statusCode || 500, 'APPLICATION_FAILED', {
          cause     : err,
          uncertain : effectsCompleted || err?.uncertain === true,
        });
      }
    },
  };
}
module.exports = { workspacesMaintenanceWorkflowService };
