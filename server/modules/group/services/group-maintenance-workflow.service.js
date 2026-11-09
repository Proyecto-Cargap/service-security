/** @file Casos de uso de mantenimiento del recurso group; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de mantenimiento con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function groupMaintenanceWorkflowService({
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
  roleDefaults,
}) {
  return {
    /**
     * Prepara los datos de grupos y coordina la creación del registro y sus operaciones asociadas.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} data Datos de grupos que utiliza name.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async create(data) {
      {
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      let effectsCompleted = false;
      try {
        const system         = messaging.getContext();
        const name           = validName(data.name);
        const requestedScope = data.scope === undefined ? '' : data.scope;
        if (!groupPolicy.authorize('create', data, requestedScope, system))
          throw new ApplicationError(403, 'FORBIDDEN');
        if (
          await groupRepository.getOne(
            {
              name,
            },
            groupScopes.guest,
          )
        ) {
          throw new ApplicationError(409, `${id}-${controller}-E0002:Group exist`);
        }
        const policies = await validPolicies(data.policies === undefined ? [] : data.policies);
        const body     = {
          groupCode     : await counter.getObjectCode('GRO'),
          name,
          policies,
          workspace     : data.workspace,
          userAssigned  : data.userAssigned,
          idTransaction : system.idTransaction,
        };
        const saved    = await groupRepository.create(body, requestedScope);
        groupState.document = {
          ...body,
          workspace    : saved.workspace,
          userCreate   : saved.userCreate,
          userAssigned : saved.userAssigned,
        };
        effectsCompleted = true;

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
     * Duplica la información de un grupo existente para crear otro grupo.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {string} groupCode Código de negocio del grupo.
     * @returns {Promise<null|Object>} Datos obtenidos por la operación; los errores rechazan la promesa.
     */
    async createFromGroup(groupCode) {
      if (typeof groupCode !== 'string' || !groupCode || groupCode.length > 4096)
        throw new ApplicationError(400, 'INVALID_INPUT');
      let effectsCompleted = false;
      try {
        const system = messaging.getContext();
        groupState.document = null;
        if (!require('../policies/group.policy').authorize('create', {}, '', system))
          throw new ApplicationError(403, 'FORBIDDEN');
        const groupBase = await groupRepository.getOne(
          {
            groupCode : groupCode,
          },
          groupScopes.guest,
        );
        if (!groupBase) {
          throw new ApplicationError(500, `${id}-${controller}-E0004:Default group does not exist`);
        }
        const body  = {
          groupCode     : await counter.getObjectCode('GRO'),
          name          : groupBase.name,
          policies      : groupBase.policies,
          root          : false,

          idTransaction : system.idTransaction,
        };
        const saved = await groupRepository.create(body);
        groupState.document = {
          ...body,
          workspace    : saved.workspace,
          userCreate   : saved.userCreate,
          userAssigned : saved.userAssigned,
        };
        effectsCompleted = true;
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
     * Localiza el registro de grupos, aplica los cambios admitidos por esta operación y los persiste.
     * Devuelve datos de aplicación y propaga errores con código estable.
     *
     * @param {Object} condition Filtro de selección original; las restricciones se componen sin modificarlo.
     * @param {Object} data Datos de grupos que utiliza name, policies.
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
        groupState.document = null;
        const requestedScope   = data.scope === undefined ? '' : data.scope;
        const authorizedFilter = groupPolicy.authorize('update', condition, requestedScope, {
          ...messaging.getContext(),
          changes : data,
        });
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        groupState.document = await groupRepository.getOne(authorizedFilter, groupScopes.guest);
        if (!groupState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0003:Group code is required`);
        }
        if (
          data.workspace !== undefined &&
          data.workspace !== 'allWorkspaces' &&
          (await roleDefaults.uses('group', groupState.document.groupCode))
        )
          throw new ApplicationError(409, 'GROUP_IN_USE');
        const name = data.name === undefined ? groupState.document.name : validName(data.name);
        if (
          name !== groupState.document.name &&
          (await groupRepository.getOne(
            {
              name,
              groupCode : { $ne: groupState.document.groupCode },
            },
            groupScopes.guest,
          ))
        )
          throw new ApplicationError(409, 'GROUP_NAME_EXISTS');
        const policies =
          data.policies === undefined
            ? groupState.document.policies
            : await validPolicies(data.policies, groupState.document.policies);
        for (const field of ['workspace', 'userAssigned']) {
          if (Object.hasOwn(data, field)) groupState.document[field] = data[field];
        }
        groupState.document.name = name;
        groupState.document.policies = policies;
        groupState.document = await groupRepository.updateItem(groupState.document, requestedScope);
        effectsCompleted = true;

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
     * Localiza y elimina el registro de grupos y coordina las operaciones asociadas presentes en este flujo.
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
        groupState.document = null;
        const authorizedFilter = groupPolicy.authorize(
          'delete',
          condition,
          scope,
          messaging.getContext(),
        );
        if (!authorizedFilter) throw new ApplicationError(403, 'FORBIDDEN');
        const group = await groupRepository.getOne(authorizedFilter, groupScopes.guest);
        if (!group) throw new ApplicationError(404, 'GROUP_NOT_FOUND');
        if (
          (await groupRepository.hasAssignedUsers(group.groupCode)) ||
          (await roleDefaults.uses('group', group.groupCode))
        )
          throw new ApplicationError(409, 'GROUP_IN_USE');
        groupState.document = await groupRepository.deleteOne(
          { $and: [condition, { groupCode: group.groupCode }] },
          false,
          scope,
        );
        effectsCompleted = !!groupState.document;
        if (!groupState.document) {
          throw new ApplicationError(404, `${id}-${controller}-E0003:Group code is required`);
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
module.exports = { groupMaintenanceWorkflowService };
