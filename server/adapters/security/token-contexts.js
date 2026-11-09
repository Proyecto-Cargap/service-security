/** @file Construye emisor y audiencia por propósito al componer Security, sin consultar el entorno durante un caso de uso. */
'use strict';
const { jwtContext } = require('../../shared/jwt-context');

/**
 * Obtiene una instantánea inmutable de los contextos JWT del proyecto y ambiente recibidos.
 * @param {Object} environment Configuración explícita con PLATFORM_ID y ENV_NAME.
 * @returns {Object} Contextos de sesión, confirmación, recuperación y ejecución de agentes.
 * @throws {Error} Si falta la identidad del ambiente; nunca utiliza valores alternativos.
 */
function tokenContexts(environment) {
  const result = {};
  for (const purpose of [
    'session',
    'account_confirmation',
    'password_recovery',
    'agent_execution',
  ]) {
    result[purpose] = Object.freeze(jwtContext(purpose, environment));
  }
  return Object.freeze(result);
}

module.exports = { tokenContexts };
