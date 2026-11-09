/** @file Contratos RPC internos de identidad y credenciales de agentes. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
/**
 * Adapta las operaciones de identidad conservando el origen del sobre.
 * @param {Object} dependencies Mensajería y repositorios de Security.
 * @returns {Object} Handlers RPC de aprovisionamiento, resolución y autenticación.
 */
function agentPrincipalController(dependencies) {
  const service =
    dependencies.agentPrincipal || require('../services/agent-principal.service')(dependencies);
  /**
   * Ejecuta input dentro del flujo de agent-principal.controller.
   * @param {Object} message Mensaje recibido con datos y contexto del transporte.
   * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  function input(message) {
    if (
      !message ||
      !message.data ||
      typeof message.data !== 'object' ||
      Array.isArray(message.data)
    )
      throw new ApplicationError(400, 'INVALID_INPUT');
    return message.data;
  }
  return {
    /** @param {Object} message Revisión aceptada. @returns {Promise<Object>} Principal activado. */
    async activate(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.activate(input(message), message.originService),
      );
    },
    /** @param {Object} message Solicitud de baja. @returns {Promise<Object>} Principal revocado. */
    async revoke(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.revoke(input(message), message.originService),
      );
    },
    /** @param {Object} message Destinatarios del contenido. @returns {Promise<Object>} Principales independientes. */
    async audience(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.audience(input(message), message.originService),
      );
    },
    /** @param {Object} message Audiencias ordenadas. @returns {Promise<Object>} Resultado independiente por ejecución. */
    async audienceBatch(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.audienceBatch(input(message), message.originService),
      );
    },
    /** @param {Object} message Solicitud administrativa de Intelligence. @returns {Promise<Object>} Identidad creada o existente. */
    async provision(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.provision(input(message), message.originService),
      );
    },
    /** @param {Object} message Solicitud del runtime. @returns {Promise<Object>} Credencial y principal vigente. */
    async resolve(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.resolve(input(message), message.originService),
      );
    },
    /** @param {Object} message Credencial interna. @returns {Promise<Object>} Principal vigente autenticado. */
    async authenticate(message) {
      return dependencies.messaging.successResponse(
        200,
        await service.authenticate(input(message), message.originService),
      );
    },
  };
}
module.exports = agentPrincipalController;
