/** @file Generación de UUID y secuencias del servicio; el modelo se inyecta desde la composición. */
'use strict';

const { randomUUID } = require('node:crypto');
const { pad }        = require('../../../shared/general');
const policy         = require('../policies/counters.policy');
/** Conserva el primer valor cero y evita duplicar la secuencia cuando su creación es concurrente.
 * @param {Object} options Colaboradores u opciones: model.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
module.exports = function createCountersRepository({ model }) {
  return {
    /**
     * Resuelve getObjectCode aplicando los filtros y colaboradores del módulo.
     * @param {*} prefix Valor de prefix utilizado por esta operación.
     * @param {*} [mode] Valor de mode utilizado por esta operación.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async getObjectCode(prefix, mode = 'id') {
      if (mode !== 'code') return prefix + '-' + randomUUID();
      const filter    = policy.authorize('update', { _id: prefix }, policy.trustedScopes.guest, {});
      /**
       * Ejecuta increment dentro del flujo de counters.repository.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      const increment = () =>
        model.findOneAndUpdate(
          filter,
          {
            $inc : {
              seq : 1,
            },
          },
          {
            returnDocument : 'after',
            runValidators  : true,
          },
        );
      let counter     = await increment();
      if (!counter) {
        try {
          const input = policy.authorize(
            'create',
            {
              _id          : prefix,
              seq          : 0,
              workspace    : 'allWorkspaces',
              userCreate   : '',
              userAssigned : '',
            },
            policy.trustedScopes.guest,
            {},
          );
          counter = await model.create(input);
        } catch (error) {
          if (error.code !== 11000) throw error;
          counter = await increment();
          if (!counter) throw error;
        }
      }
      return prefix + pad(counter.seq, 7);
    },
  };
};
