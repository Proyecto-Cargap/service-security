/**
 * @file Controlador de group: adapta las acciones de mensajería y conserva sus respuestas públicas.
 */
'use strict';
const { groupPresenter } = require('../presenters/group.presenter');
const { publicPage }     = require('../../../shared/public-record');

/**
 * Construye los handlers de group con dependencias explícitas.
 *
 * @param {Object} dependencies Mensajería y dependencias de aplicación de esta capacidad.
 * @returns {Object} Handlers de las operaciones publicadas en el catálogo.
 */
module.exports = function groupController(dependencies) {
  const { ApplicationError } = require('../../../shared/application-error');
  const messaging            = dependencies.messaging;
  const { id }               = require('../../../../package.json');
  const groupService         = dependencies.services?.group;
  const controller           = 'C005';
  return {
    /**
     * Crea un grupo con los metadatos autorizados por su política.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene name, workspace, userAssigned y scope.
     * @returns {Promise<Object>} Sobre de respuesta 201 con el grupo creado.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    create       : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const groupServiceInstance = groupService(dependencies);
      const groupValue           = await groupServiceInstance.create(mqMessage.data);
      return messaging.successResponse(201, groupPresenter(groupValue));
    },

    /**
     * Obtiene un grupo identificado por código.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el grupo; 204 con la descripción existente cuando el servicio devuelve null.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getOne       : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0003:Group code is required`);
      }
      const groupServiceInstance = groupService(dependencies);
      const groupValue           = await groupServiceInstance.getOne(
        {
          groupCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      if (groupValue == null)
        return messaging.errorResponse(204, `${id}-${'C001'}-E0004:Group does not exist`);
      return messaging.successResponse(200, groupPresenter(groupValue));
    },

    /**
     * Consulta grupos con los filtros y la paginación del servicio.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene fields, sort, order, page, perPage, search, condition y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con pagination e items.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getList      : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const groupServiceInstance = groupService(dependencies);
      const groupValue           = await groupServiceInstance.getList(mqMessage.data);
      return messaging.successResponse(200, publicPage(groupValue, groupPresenter));
    },

    /**
     * Actualiza los datos y las políticas del grupo identificado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code, field, name, policies, workspace, userAssigned y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    update       : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      if (mqMessage.data.code == undefined) {
        throw new ApplicationError(400, `${id}-${controller}-E0006:Group code is required`);
      }
      const groupServiceInstance = groupService(dependencies);
      await groupServiceInstance.update(
        {
          groupCode : mqMessage.data.code,
        },
        mqMessage.data,
      );
      return messaging.successResponse(200);
    },

    /**
     * Elimina físicamente el grupo identificado con el alcance solicitado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    delete       : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0006:Group code is required`);
      }
      const groupServiceInstance = groupService(dependencies);
      await groupServiceInstance.delete(
        {
          groupCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      return messaging.successResponse(200);
    },

    /**
     * Añade una política al grupo mediante el caso de uso autorizado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y policyCode.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    addPolicy    : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const groupServiceInstance = groupService(dependencies);
      await groupServiceInstance.addPolicy(mqMessage.data);
      return messaging.successResponse(200);
    },

    /**
     * Retira una política del grupo mediante el caso de uso autorizado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y policyCode.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    removePolicy : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const groupServiceInstance = groupService(dependencies);
      await groupServiceInstance.removePolicy(mqMessage.data);
      return messaging.successResponse(200);
    },
  };
};
