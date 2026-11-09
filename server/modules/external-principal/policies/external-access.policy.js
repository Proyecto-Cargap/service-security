/** @file Límite de permisos de personas externas: sólo conversación propia, invocación y lectura documental explícita. */
'use strict';
const BASE = Object.freeze([
  'communication.chat.view.workspace',
  'communication.chat.create.workspace',
  'intelligence.run.create.owner',
  'intelligence.run.view.owner',
  'intelligence.agent.invoke.workspace',
]);
/** Reduce grupos externos a lectura documental; jamás concede administración ni credenciales.
 * @param {string[]} identifiers Permisos efectivos de grupos vigentes.
 * @returns {string[]} Permisos del sujeto externo, independientes del operador.
 */
function externalPolicies(identifiers) {
  return [
    ...new Set([
      ...BASE,
      ...identifiers.filter(
        /** @param {string} value Identificador de permiso. @returns {boolean} Sólo lectura documental con ámbito explícito. */
        (value) =>
          /^documents\.(entries|files|repositories|personal|workspace|global)\.view\.(global|workspace|owner|assigned)$/.test(
            value,
          ),
      ),
    ]),
  ];
}
module.exports = { externalPolicies };
