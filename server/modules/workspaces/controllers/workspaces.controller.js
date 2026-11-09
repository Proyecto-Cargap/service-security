/**
 * @file Controlador de workspaces: adapta las acciones de mensajería y conserva sus respuestas públicas.
 */
'use strict';
const { workspacesPresenter } = require('../presenters/workspaces.presenter');
const { publicPage }          = require('../../../shared/public-record');

/**
 * Construye los handlers de workspaces con dependencias explícitas.
 *
 * @param {Object} dependencies Mensajería y dependencias de aplicación de esta capacidad.
 * @returns {Object} Handlers de las operaciones publicadas en el catálogo.
 */
module.exports = function workspacesController(dependencies) {
  const { ApplicationError } = require('../../../shared/application-error');
  const messaging            = dependencies.messaging;
  const { id }               = require('../../../../package.json');
  const workspacesService    = dependencies.services?.workspaces;
  const controller           = 'C005';
  return {
    /**
     * Crea un espacio de trabajo con los metadatos autorizados.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene name, workspace, userAssigned y scope.
     * @returns {Promise<Object>} Sobre de respuesta 201 con el espacio creado.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    create  : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const workspacesServiceInstance = workspacesService(dependencies);
      const workspacesValue           = await workspacesServiceInstance.create(mqMessage.data);
      return messaging.successResponse(201, workspacesPresenter(workspacesValue));
    },

    /**
     * Obtiene un espacio de trabajo por su código.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el espacio; 204 con la descripción existente cuando el servicio devuelve null.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getOne  : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0003:Workspaces code is required`);
      }
      const workspacesServiceInstance = workspacesService(dependencies);
      const workspacesValue           = await workspacesServiceInstance.getOne(
        {
          workspaceCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      if (workspacesValue == null)
        return messaging.errorResponse(204, `${id}-${'C001'}-E0004:Workspaces does not exist`);
      return messaging.successResponse(200, workspacesPresenter(workspacesValue));
    },

    /**
     * Consulta espacios de trabajo con filtros y paginación del servicio.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene fields, sort, order, page, perPage, search, condition y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con pagination e items.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getList : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const workspacesServiceInstance = workspacesService(dependencies);
      const workspacesValue           = await workspacesServiceInstance.getList(mqMessage.data);
      return messaging.successResponse(200, publicPage(workspacesValue, workspacesPresenter));
    },

    /**
     * Actualiza el espacio de trabajo identificado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code, field, name, description, picture, workspace, userAssigned y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    update  : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0006:Workspaces code is required`);
      }
      const workspacesServiceInstance = workspacesService(dependencies);
      await workspacesServiceInstance.update(
        {
          workspaceCode : mqMessage.data.code,
        },
        mqMessage.data,
      );
      return messaging.successResponse(200);
    },

    /**
     * Elimina físicamente el espacio de trabajo identificado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    delete  : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0006:Workspaces code is required`);
      }
      const workspacesServiceInstance = workspacesService(dependencies);
      await workspacesServiceInstance.delete(
        {
          workspaceCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      return messaging.successResponse(200);
    },
  };
};
