/**
 * @file Controlador de settings: adapta las acciones de mensajería y conserva sus respuestas públicas.
 */
'use strict';
const { settingsPresenter } = require('../presenters/settings.presenter');

/**
 * Construye los handlers de settings con dependencias explícitas.
 *
 * @param {Object} dependencies Mensajería y dependencias de aplicación de esta capacidad.
 * @returns {Object} Handlers de las operaciones publicadas en el catálogo.
 */
module.exports = function settingsController(dependencies) {
  const { ApplicationError } = require('../../../shared/application-error');
  const messaging            = dependencies.messaging;
  return {
    /**
     * Lee un parámetro técnico mediante su repositorio autorizado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene parameter y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 con el parámetro completo.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    getOne  : async (mqMessage) => {
      if (!mqMessage?.data || typeof mqMessage.data !== 'object' || Array.isArray(mqMessage.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const service = dependencies.services.settings(dependencies);
      return messaging.successResponse(
        200,
        settingsPresenter(await service.getOne(mqMessage.data)),
      );
    },

    /**
     * Lista los parámetros visibles; valida page y perPage pero conserva la lista completa.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene scope y, opcionalmente, page y perPage.
     * @returns {Promise<Object>} Sobre de respuesta 200 con la lista completa de parámetros.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    getList : async (mqMessage) => {
      if (!mqMessage?.data || typeof mqMessage.data !== 'object' || Array.isArray(mqMessage.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const service = dependencies.services.settings(dependencies);
      return messaging.successResponse(
        200,
        (await service.getList(mqMessage.data)).map(settingsPresenter),
      );
    },

    /**
     * Actualiza el contenido del parámetro técnico identificado.
     *
     * @param {Object} mqMessage Mensaje cuya propiedad data contiene parameter, data y scope.
     * @returns {Promise<Object>} Sobre de respuesta 200 sin datos adicionales.
     * @throws {ApplicationError|Error} 400 ante una entrada inválida; conserva los errores públicos y transforma fallos inesperados en 500 APPLICATION_FAILED.
     */
    update  : async (mqMessage) => {
      if (!mqMessage?.data || typeof mqMessage.data !== 'object' || Array.isArray(mqMessage.data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const service = dependencies.services.settings(dependencies);
      await service.update(mqMessage.data);
      return messaging.successResponse(200);
    },
  };
};
