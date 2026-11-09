/**
 * @file Controlador de policy: adapta las acciones de mensajería y conserva sus respuestas públicas.
 */
'use strict';
const { policyPresenter } = require('../presenters/policy.presenter');
const { publicPage }      = require('../../../shared/public-record');

/**
 * Construye los handlers de policy con dependencias explícitas.
 *
 * @param {Object} dependencies Mensajería y dependencias de aplicación de esta capacidad.
 * @returns {Object} Handlers de las operaciones publicadas en el catálogo.
 */
module.exports = function policyController(dependencies) {
  const { ApplicationError } = require('../../../shared/application-error');
  const messaging            = dependencies.messaging;
  const logger               = dependencies.logger || {
    /**
     * Ofrece el punto de extensión error sin efectos por defecto.
     * @returns {void} Finaliza después de aplicar los efectos de la operación.
     */
    error() {},
  };
  const { id }               = require('../../../../package.json');
  const policyService        = dependencies.services?.policy;
  const controller           = 'C002';
  return {
    /**
     * Crea una política con un identificador de permiso exacto.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene identifier, service, section, description, active, base, workspace, userAssigned y scope.
     * @returns {Promise<Object>} Sobre de respuesta 201 con la política creada.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    create   : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const policyServiceInstance = policyService(dependencies);
      const policyValue           = await policyServiceInstance.create(mqMessage.data);
      return messaging.successResponse(201, policyPresenter(policyValue));
    },

    /**
     * Obtiene una política por su código.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con la política; 204 con la descripción existente cuando el servicio devuelve null.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getOne   : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      if (mqMessage.data.code == undefined || mqMessage.data.code == '') {
        throw new ApplicationError(400, `${id}-${controller}-E0006:Policy code is required`);
      }
      const policyServiceInstance = policyService(dependencies);
      const policyValue           = await policyServiceInstance.getOne(
        {
          policyCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      if (policyValue == null)
        return messaging.errorResponse(204, `${id}-${'C001'}-E0005:User does not exist`);
      return messaging.successResponse(200, policyPresenter(policyValue));
    },

    /**
     * Consulta políticas con filtros y paginación del servicio.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene fields, sort, order, page, perPage, search, dateRange, active, base, index, condition y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con pagination e items.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getList  : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const policyServiceInstance = policyService(dependencies);
      const policyValue           = await policyServiceInstance.getList(mqMessage.data);
      return messaging.successResponse(200, publicPage(policyValue, policyPresenter));
    },

    /**
     * Actualiza la política identificada y conserva el alcance solicitado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code, field, identifier, service, section, description, active, base, workspace, userAssigned y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    update   : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      try {
        if (mqMessage.data.code == undefined) {
          throw new ApplicationError(400, `${id}-${controller}-E0006:Policy code is required`);
        }
        const policyServiceInstance = policyService(dependencies);
        await policyServiceInstance.update(
          {
            policyCode : mqMessage.data.code,
          },
          mqMessage.data,
        );
        return messaging.successResponse(200);
      } catch (err) {
        if (err?.statusCode) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(500, 'APPLICATION_FAILED');
      }
    },

    /**
     * Elimina físicamente la política identificada.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    delete   : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      try {
        if (mqMessage.data.code == undefined || mqMessage.data.code == '') {
          throw new ApplicationError(400, `${id}-${controller}-E0006:Policy code is required`);
        }
        const policyServiceInstance = policyService(dependencies);
        await policyServiceInstance.delete(
          {
            policyCode : mqMessage.data.code,
          },
          mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
        );
        return messaging.successResponse(200);
      } catch (err) {
        if (err?.statusCode) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(500, 'APPLICATION_FAILED');
      }
    },

    /**
     * Obtiene los nombres distintos de servicios dentro de las políticas visibles.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene un objeto data sin campos funcionales; la visibilidad procede del contexto verificado.
     * @returns {Promise<Object>} Sobre de respuesta 200 cuya propiedad data.items contiene los nombres de servicios visibles.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    getIndex : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      try {
        const policyServiceInstance = policyService(dependencies);
        const policyValue           = await policyServiceInstance.getDistinct('service');
        return messaging.successResponse(200, policyValue);
      } catch (err) {
        if (err?.statusCode) throw err;
        logger.error({
          component : 'service',
          event     : 'handler_failed',
          code      : 'INTERNAL_ERROR',
        });
        throw new ApplicationError(500, 'APPLICATION_FAILED');
      }
    },
  };
};
