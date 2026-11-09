/** @file Acciones de identidad con contratos cerrados por capacidad de dominio. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
/**
 * Compone identityController con las dependencias recibidas y devuelve su interfaz.
 * @param {Object} dependencies Colaboradores explícitos de la composición.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function identityController(dependencies) {
  const service = require('../services/identity.service').identityService(dependencies);
  const fields  = {
    current            : [],
    ownAccess          : [],
    userPrincipals     : ['userCodes'],
    deliveryAddresses  : ['userCodes'],
    personalPrincipals : ['userCodes'],
    principals         : ['workspace', 'userCodes'],
    references         : ['codes'],
    profiles           : ['codes'],
    profile            : ['userCode'],
    picture            : ['userCode', 'size'],
    activeProfiles     : [
      'userCodes',
      'contactCodes',
      'search',
      'page',
      'perPage',
      'includeUnconfirmed',
    ],
    directory          : ['codes', 'search', 'page', 'workspace'],
    workspaceUsers     : ['workspace', 'userCodes', 'page', 'perPage'],
  };
  return Object.fromEntries(
    Object.keys(fields).map(
      /**
       * Proyecta cada elemento en la estructura requerida por la operación.
       * @param {*} operation Valor de operation utilizado por esta operación.
       * @returns {Array<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (operation) => [
        operation,

        /**
         * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
         * @param {Object} message Mensaje recibido con datos y contexto del transporte.
         * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        async (message) => {
          const data = message?.data;
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
              (key) => !fields[operation].includes(key),
            )
          )
            throw new ApplicationError(400, 'INVALID_INPUT');
          const result =
            operation === 'current'
              ? await service.current(message.originService)
              : await service[operation](data, message.originService);
          return dependencies.messaging.successResponse(200, result);
        },
      ],
    ),
  );
}
module.exports = { identityController };
