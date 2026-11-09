/** @file Casos de uso de membresía del recurso group; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de membresía con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function groupMembershipsWorkflowService({
  ApplicationError,
  groupPolicy,
  groupRepository,
  groupScopes,
  groupState,
  logger,
  messaging,

  validPolicies,
}) {
  return {
    /**
     * Añade una política a la lista de permisos del grupo y persiste el documento.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de grupos que utiliza code, policyCode.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async addPolicy(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      if (
        typeof data.code !== 'string' ||
        !data.code ||
        typeof data.policyCode !== 'string' ||
        !data.policyCode
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      let effectsCompleted = false;
      try {
        const filter = groupPolicy.authorize('update', { groupCode: data.code }, '', {
          ...messaging.getContext(),
          changes : {},
        });
        if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
        groupState.document = await groupRepository.getOne(filter, groupScopes.guest);
        if (!groupState.document) throw new ApplicationError(404, 'GROUP_NOT_FOUND');
        await validPolicies(
          [...new Set([...groupState.document.policies, data.policyCode])],
          groupState.document.policies,
        );
        if (!groupState.document.policies.includes(data.policyCode)) {
          groupState.document = await groupRepository.update(filter, {
            $addToSet : { policies: data.policyCode },
          });
          if (!groupState.document) throw new ApplicationError(409, 'GROUP_CHANGED_CONCURRENTLY');
          effectsCompleted = true;
        }

        return groupState.document;
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
     * Retira una política de la lista de permisos del grupo y persiste el documento.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de grupos que utiliza code, policyCode.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async removePolicy(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      if (
        typeof data.code !== 'string' ||
        !data.code ||
        typeof data.policyCode !== 'string' ||
        !data.policyCode
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      let effectsCompleted = false;
      try {
        const filter = groupPolicy.authorize('update', { groupCode: data.code }, '', {
          ...messaging.getContext(),
          changes : {},
        });
        if (!filter) throw new ApplicationError(403, 'FORBIDDEN');
        groupState.document = await groupRepository.getOne(filter, groupScopes.guest);
        if (!groupState.document) throw new ApplicationError(404, 'GROUP_NOT_FOUND');
        if (groupState.document.policies.includes(data.policyCode)) {
          groupState.document = await groupRepository.update(filter, {
            $pull : { policies: data.policyCode },
          });
          if (!groupState.document) throw new ApplicationError(409, 'GROUP_CHANGED_CONCURRENTLY');
          effectsCompleted = true;
        }

        return groupState.document;
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
module.exports = { groupMembershipsWorkflowService };
