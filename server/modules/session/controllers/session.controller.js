/**
 * @file Controlador de session: adapta las acciones de mensajería y conserva sus respuestas públicas.
 */
'use strict';

/**
 * Construye los handlers de session con dependencias explícitas.
 *
 * @param {Object} dependencies Mensajería y dependencias de aplicación de esta capacidad.
 * @returns {Object} Handlers de las operaciones publicadas en el catálogo.
 */
module.exports = function sessionController(dependencies) {
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
  const sessionService       = dependencies.services?.session;
  const controller           = 'C004';
  /**
   * Ejecuta ownRequest dentro del flujo de session.controller.
   * @param {Object} message Mensaje recibido con datos y contexto del transporte.
   * @param {boolean} [windowRead] Admite lecturas privadas de ventanas desde Platform.
   * @returns {void} Finaliza después de aplicar los efectos de la operación.
   */
  function ownRequest(message, windowRead = false) {
    if (
      message?.originService !== 'service-apigateway' &&
      !(windowRead && message?.originService === 'service-platform')
    )
      throw new ApplicationError(403, 'FORBIDDEN');
  }
  return {
    /** @param {Object} message Entrada vacía y contexto autenticado. @returns {Promise<Object>} Perfil propio sin ampliar permisos. */
    ownProfile        : async (message) => {
      ownRequest(message, true);
      if (
        !message?.data ||
        typeof message.data !== 'object' ||
        Array.isArray(message.data) ||
        Object.keys(message.data).length
      )
        throw new ApplicationError(400, 'INVALID_INPUT');
      return messaging.successResponse(200, await sessionService(dependencies).getOwnProfile());
    },
    /** @param {Object} message Variante de foto y contexto autenticado. @returns {Promise<Object>} Transferencia privada del contacto actual. */
    ownProfilePicture : async (message) => {
      ownRequest(message);
      if (!message?.data || typeof message.data !== 'object' || Array.isArray(message.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      return messaging.successResponse(
        200,
        await sessionService(dependencies).getOwnProfilePicture(message?.data),
      );
    },
    /** @param {Object} message Código de sesión y variante, con contexto autenticado. @returns {Promise<Object>} Temporal privado después de autorizar la sesión. */
    profilePicture    : async (message) => {
      if (!message?.data || typeof message.data !== 'object' || Array.isArray(message.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      return messaging.successResponse(
        200,
        await sessionService(dependencies).getProfilePicture(message.data),
      );
    },
    /**
     * Autentica las credenciales y abre una sesión en el espacio de trabajo solicitado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene user y password; workspaceCode es opcional.
     * @returns {Promise<Object>} Sobre de respuesta 201 con token, activeWorkspace, usuario y permisos de sesión.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    create            : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const sessionServiceInstance = sessionService(dependencies);
      const session                = await sessionServiceInstance.create(mqMessage.data);
      return messaging.successResponse(201, session);
    },

    /**
     * Consulta la ficha administrativa con autorización y una proyección sin credenciales.
     *
     * @param {Object} mqMessage Datos con code y scope autenticado.
     * @returns {Promise<Object>} Sobre 200 con la ficha pública, o 204 si no es visible.
     * @throws {ApplicationError} Entrada inválida o consulta denegada.
     */
    getOne            : async (mqMessage) => {
      if (!mqMessage?.data || typeof mqMessage.data !== 'object' || Array.isArray(mqMessage.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const item = await sessionService(dependencies).getOne(
        mqMessage.data.code,
        mqMessage.data.scope ?? '',
      );
      return messaging.successResponse(item ? 200 : 204, item);
    },

    /**
     * Consulta las sesiones visibles con filtros y paginación del servicio.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene fields, sort, order, page, perPage, active, dateRange, roleCode, userCode y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con pagination e items.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    getList           : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const sessionServiceInstance = sessionService(dependencies);
      const sessionValue           = await sessionServiceInstance.getList(mqMessage.data);
      return messaging.successResponse(200, sessionValue);
    },

    /**
     * Cambia el espacio activo de una sesión mediante la autorización del servicio.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code, workspaceCode y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    update            : async (mqMessage) => {
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
          throw new ApplicationError(400, `${id}-${controller}-E0004:Session code is required`);
        }
        const sessionServiceInstance = sessionService(dependencies);
        await sessionServiceInstance.update(
          {
            sessionCode : mqMessage.data.code,
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
     * Cierra la sesión activa identificada con el permiso de eliminación.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    delete            : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0006:code is required`);
      }
      const sessionServiceInstance = sessionService(dependencies);
      await sessionServiceInstance.delete(
        {
          sessionCode : mqMessage.data.code,
        },
        mqMessage.data.scope === undefined ? '' : mqMessage.data.scope,
      );
      return messaging.successResponse(200);
    },

    /** @param {Object} message Credencial acreditada por Gateway. @returns {Promise<Object>} Sesión 200 reconstruida sin rotación ni ampliación de vigencia. */
    restore           : async (message) => {
      ownRequest(message);
      if (!message?.data || typeof message.data !== 'object' || Array.isArray(message.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      return messaging.successResponse(
        200,
        await sessionService(dependencies).restore(message.data),
      );
    },

    /**
     * Renueva una sesión a partir de su token firmado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code como token de sesión.
     * @returns {Promise<Object>} Sobre de respuesta 201 con token, activeWorkspace, usuario y permisos renovados.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    renovate          : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const sessionServiceInstance = sessionService(dependencies);
      const session                = await sessionServiceInstance.renovate(mqMessage.data);
      return messaging.successResponse(201, session);
    },

    /**
     * Cierra la sesión después de que el servicio verifique su token firmado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene code como token de sesión.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 si falta el código, 404 si el recurso no existe o no es visible y 500 OPERATION_FAILED ante fallos inesperados.
     */
    closeToken        : async (mqMessage) => {
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
        throw new ApplicationError(400, `${id}-${controller}-E0006:code is required`);
      }
      const sessionServiceInstance = sessionService(dependencies);
      const session                = await sessionServiceInstance.closeToken(mqMessage.data.code);
      if (!session) {
        throw new ApplicationError(404, `${id}-${controller}-E0008:Session does not exist`);
      }
      return messaging.successResponse(200);
    },

    /**
     * Verifica la sesión para una colaboración interna y devuelve identidad sin secretos.
     *
     * @param {Object} mqMessage data contiene token y la opción currentPolicies de lectura vigente.
     * @returns {Promise<Object>} Identidad 200 sin secretos; currentPoliciesVerified acredita la lectura vigente cuando se solicita.
     * @throws {ApplicationError|Error} 400 si el mensaje no tiene la forma requerida; propaga los errores de validación, autorización y persistencia del servicio.
     */
    authenticate      : async (mqMessage) => {
      {
        if (
          !mqMessage ||
          !mqMessage.data ||
          typeof mqMessage.data !== 'object' ||
          Array.isArray(mqMessage.data)
        )
          throw new ApplicationError(400, 'INVALID_INPUT');
      }
      const sessionServiceInstance = sessionService(dependencies);
      const result                 = await sessionServiceInstance.authenticate(mqMessage.data);
      return messaging.successResponse(200, result);
    },
  };
};
