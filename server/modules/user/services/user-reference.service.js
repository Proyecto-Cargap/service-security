/** @file Consulta de integridad de clasificadores asociados a usuarios; no expone cuentas ni elige una proyección por consumidor. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
const { trustedScopes }    = require('../policies/user.policy');

/**
 * Compone una consulta mínima de integridad después de acreditar el acceso en la frontera.
 * @param {Object} dependencies Capacidad de lectura de referencias hasRoleReference.
 * @returns {Object} Comprobación de uso del clasificador sin modificaciones de persistencia.
 */
function userReferenceService({ userReferences: references, roleDefaults }) {
  return {
    /**
     * Comprueba si algún usuario conserva la referencia al rol indicado.
     * @param {Object} data Identificador concreto y tipo role del recurso.
     * @returns {Promise<{used:boolean}>} Resultado canónico sin identidades ni conteos.
     * @throws {ApplicationError} 400 ante un identificador o tipo inválido; propaga indisponibilidad del puerto.
     */
    async exists(data) {
      if (data.kind !== 'role' || typeof data.code !== 'string' || !data.code.trim())
        throw new ApplicationError(400, 'INVALID_REFERENCE');
      return {
        used :
          (await references.hasRoleReference(data.code, trustedScopes.guest)) ||
          (await roleDefaults.uses('role', data.code)),
      };
    },
  };
}

module.exports = { userReferenceService };
