/** @file Casos de uso de mantenimiento del recurso policy; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de mantenimiento con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function policyMaintenanceWorkflowService({
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
}) {
  return {
    /**
     * Prepara los datos de políticas de acceso y coordina la creación del registro y sus operaciones
     * asociadas.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de políticas de acceso que utiliza identifier, service, section,
     * description, active, base.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async create(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        if (data.identifier == undefined || data.identifier == '') {
          throw new ApplicationError(400, `${id}-${controller}-E0001:Identifier is required`);
        }
        if (data.service == undefined || data.service == '') {
          throw new ApplicationError(400, `${id}-${controller}-E0002:Service is required`);
        }
        if (data.section == undefined || data.section == '') {
          throw new ApplicationError(400, `${id}-${controller}-E0003:Section is required`);
        }
        if (data.description == undefined || data.description == '') {
          throw new ApplicationError(400, `${id}-${controller}-E0004:Description is required`);
        }
        if (!POLICY_IDENTIFIER.test(data.identifier))
          throw new ApplicationError(400, 'INVALID_POLICY_IDENTIFIER');
        const requestedScope = data.scope === undefined ? '' : data.scope;
        if (!policyPolicy.authorize('create', data, requestedScope, system))
          throw new ApplicationError(403, 'FORBIDDEN');
        if (
          await policyRepository.getOne(
            {
              identifier : data.identifier,
            },
            policyScopes.guest,
          )
        ) {
          throw new ApplicationError(409, `${id}-${controller}-E0005:Policy exist`);
        }
        const body = {
          policyCode    : await counter.getObjectCode('POL'),
          identifier    : data.identifier,
          service       : data.service,
          section       : data.section,
          active        : data.active,

          base          : data.base,
          description   : data.description,
          workspace     : data.workspace,
          userAssigned  : data.userAssigned,
          idTransaction : system.idTransaction,
        };
        policyState.document = await policyRepository.create(body, requestedScope);
        effectsCompleted = true;

        return policyState.document;
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
     * Localiza el registro de políticas de acceso, aplica los cambios admitidos por esta operación y los
     * persiste.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {Object} data Datos de políticas de acceso que utiliza identifier, service, section,
     * description, active, base.
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
      try {
        policyState.document = null;
        if (
          data.identifier !== undefined &&
          (typeof data.identifier !== 'string' || !POLICY_IDENTIFIER.test(data.identifier))
        )
          throw new ApplicationError(400, 'INVALID_POLICY_IDENTIFIER');
        const requestedScope   = data.scope === undefined ? '' : data.scope;
        const authorizedFilter = policyPolicy.authorize('update', condition, requestedScope, {
          ...messaging.getContext(),
          changes : data,
        });
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        policyState.document = await policyRepository.getOne(authorizedFilter, policyScopes.guest);
        if (!policyState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0007:Policy does not exist`);
        }
        for (const field of ['workspace', 'userAssigned']) {
          if (Object.hasOwn(data, field)) policyState.document[field] = data[field];
        }
        if (
          data.identifier &&
          data.identifier !== policyState.document.identifier &&
          (await policyRepository.getOne(
            {
              identifier : data.identifier,
              policyCode : { $ne: policyState.document.policyCode },
            },
            policyScopes.guest,
          ))
        )
          throw new ApplicationError(409, 'POLICY_IDENTIFIER_EXISTS');
        if (data.identifier) {
          policyState.document.identifier = data.identifier;
        }
        if (data.service) {
          policyState.document.service = data.service;
        }
        if (data.section) {
          policyState.document.section = data.section;
        }
        if (data.description) {
          policyState.document.description = data.description;
        }
        if (data.active != undefined) {
          policyState.document.active = data.active;
        }

        if (data.base != undefined) {
          policyState.document.base = data.base;
        }
        await policyRepository.updateItem(policyState.document, requestedScope);
        effectsCompleted = true;

        return policyState.document;
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
    /**
     * Localiza y elimina el registro de políticas de acceso y coordina las operaciones asociadas presentes en
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
        policyState.document = null;
        const filter = policyPolicy.authorize('delete', condition, scope, messaging.getContext());
        if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
        const record = await policyRepository.getOne(filter, policyScopes.guest);
        if (!record) throw new ApplicationError(404, 'NOT_FOUND');
        if (await policyRepository.hasReferences(record.policyCode))
          throw new ApplicationError(409, 'POLICY_IN_USE');
        policyState.document = await policyRepository.deleteOne(condition, false, scope);
        effectsCompleted = true;
        if (!policyState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0007:Policy does not exist`);
        }

        return policyState.document;
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
module.exports = { policyMaintenanceWorkflowService };
