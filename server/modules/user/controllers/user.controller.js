/**
 * @file Controlador de user: adapta las acciones de mensajería y conserva sus respuestas públicas.
 */
'use strict';
const { userPresenter, userPagePresenter } = require('../presenters/user.presenter');

/**
 * Construye los handlers de user con dependencias explícitas.
 *
 * @param {Object} dependencies Mensajería y dependencias de aplicación de esta capacidad.
 * @returns {Object} Handlers de las operaciones publicadas en el catálogo.
 */
module.exports = function userController(dependencies) {
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
  const userService          = dependencies.services?.user;
  const controller           = 'C001';
  return {
    /**
     * Comprueba únicamente el uso de un Role para una baja autorizada en Directory.
     * @param {Object} mqMessage Mensaje interno con origen service-directory y data {kind, code}.
     * @returns {Promise<Object>} Sobre 200 con {used:boolean}, sin usuarios ni conteos.
     * @throws {ApplicationError} 403 por origen ajeno; 400 por identificador o campos no admitidos.
     */
    checkDirectoryReference : async (mqMessage) => {
      if (
        !mqMessage ||
        !mqMessage.data ||
        typeof mqMessage.data !== 'object' ||
        Array.isArray(mqMessage.data)
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      if (mqMessage.originService !== 'service-directory')
        throw new ApplicationError(403, 'FORBIDDEN');
      const data = mqMessage.data;
      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).some(
          /**
           * Comprueba si el elemento satisface la condición.
           * @param {string} key Clave del campo o recurso que se procesa.
           * @returns {boolean} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (key) => !['kind', 'code'].includes(key),
        ) ||
        data.kind !== 'role' ||
        typeof data.code !== 'string' ||
        !data.code.trim()
      )
        throw new ApplicationError(400, 'INVALID_REFERENCE');
      const referenceService = dependencies.services.userReference(dependencies);
      return messaging.successResponse(200, await referenceService.exists(data));
    },
    /**
     * Crea un usuario administrativo o reactiva una cuenta cuando el servicio autoriza la operación.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene user, roleCode, workspaceCode, workspace, userAssigned, groups, workspaces, validity, contactCode, name, picture y scope.
     * @returns {Promise<Object>} Sobre de respuesta 201 con el usuario creado o reactivado.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    create                  : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.create(mqMessage.data);
      return messaging.successResponse(201, userPresenter(userValue));
    },

    /**
     * Obtiene un usuario por su código y conserva el alcance solicitado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el usuario.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getOne                  : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0004:User code is required`);
      }
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.getOne(
        {
          erased   : 'false',
          userCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      return messaging.successResponse(200, userPresenter(userValue));
    },

    /**
     * Consulta usuarios con los filtros y la paginación resueltos por el servicio.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene fields, sort, order, page, perPage, search, dateRange, state, roleCode, userCodeList y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con pagination e items.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getList                 : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.getList(mqMessage.data);
      return messaging.successResponse(200, userPagePresenter(userValue));
    },

    /**
     * Actualiza el usuario identificado sin modificar el selector de autorización.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code, field, state, roleCode, validity, groups, workspaces, user, workspace, userAssigned, MQReplic y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    update                  : async (mqMessage) => {
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
          throw new ApplicationError(400, `${id}-${controller}-E0004:User code is required`);
        }
        const userServiceInstance = userService(dependencies);
        await userServiceInstance.update(
          {
            userCode : mqMessage.data.code,
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
     * Solicita la baja lógica del usuario y sus efectos asociados.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code, MQReplic y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el resultado de la baja.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    delete                  : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.delete(mqMessage.data);
      return messaging.successResponse(200, userPresenter(userValue));
    },

    /**
     * Registra una cuenta pública mediante el caso de uso específico de alta.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene user, roleCode, name, picture y workspaceCode; el servicio rechaza grupos y metadatos no permitidos.
     * @returns {Promise<Object>} Sobre de respuesta 201 con el usuario registrado.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    register                : async (mqMessage) => {
      if (!mqMessage?.data || typeof mqMessage.data !== 'object' || Array.isArray(mqMessage.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const userServiceInstance = userService(dependencies);
      const user                = await userServiceInstance.register(mqMessage.data);
      return messaging.successResponse(201, userPresenter(user));
    },

    /**
     * Obtiene un usuario por correo y conserva null u otros selectores para la política.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code como correo del usuario y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el usuario.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getOneByemail           : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0004:User is required`);
      }
      const scope               = mqMessage.data.scope === undefined ? '' : mqMessage.data.scope;
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.getOne(
        {
          erased : 'false',
          user   : mqMessage.data.code,
        },
        scope,
      );
      return messaging.successResponse(200, userPresenter(userValue));
    },

    /**
     * Procesa el cambio de rol recibido para la identidad indicada.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y roleCode.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    updateRole              : async (mqMessage) => {
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
          throw new ApplicationError(400, `${id}-${controller}-E0004:User code is required`);
        }
        const userServiceInstance = userService(dependencies);
        await userServiceInstance.updateRole(
          {
            userCode : mqMessage.data.code,
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
     * Solicita el envío de una nueva confirmación para el usuario autorizado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    putConfirmation         : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0004:User code is required`);
      }
      const userServiceInstance = userService(dependencies);
      await userServiceInstance.putConfirmation(mqMessage.data.code);
      return messaging.successResponse(200);
    },

    /**
     * Busca usuarios visibles asociados a una política exacta.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene identifier.
     * @returns {Promise<Object>} Sobre de respuesta 200 con los usuarios encontrados y su paginación.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    getByPolicy             : async (mqMessage) => {
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
        if (mqMessage.data.identifier == undefined || mqMessage.data.identifier == '') {
          throw new ApplicationError(
            400,
            `${id}-${controller}-E0015:Identifier policy is required`,
          );
        }
        const userServiceInstance = userService(dependencies);
        const userValue           = await userServiceInstance.getByPolicy(mqMessage.data);
        return messaging.successResponse(200, userPagePresenter(userValue));
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
     * Solicita la recuperación de contraseña de la cuenta indicada.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene user.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el resultado del servicio.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    recoverPassword         : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.recoverPassword(mqMessage.data);
      return messaging.successResponse(200, userPresenter(userValue));
    },

    /**
     * Confirma la cuenta mediante el token y la contraseña recibidos.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene token y password.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el resultado de la confirmación.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    confirm                 : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const userServiceInstance = userService(dependencies);
      const userValue           = await userServiceInstance.confirm(mqMessage.data);
      return messaging.successResponse(200, userPresenter(userValue));
    },

    /**
     * Consume el token público de recuperación y restablece la contraseña.
     * @param {Object} message Mensaje con token y password.
     * @returns {Promise<Object>} Sobre 200 sin credenciales.
     */
    updatePassword          : async (message) => {
      await userService(dependencies).updatePassword(message?.data);
      return messaging.successResponse(200);
    },
  };
};
