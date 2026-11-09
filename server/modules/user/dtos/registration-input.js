/** @file Normalización de los datos opcionales del contacto durante el alta pública. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
/** Valida un celular sin atribuirle una verificación SMS.
 * @param {{countryCode:string,number:string}|undefined} value Número recibido.
 * @returns {{countryCode:string,number:string}|undefined} Número normalizado o ausencia.
 * @throws {ApplicationError} Rechaza números y propiedades no admitidos.
 */
function registrationPhone(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some(
      /** Comprueba la lista cerrada de campos.
       * @param {string} key Campo de entrada.
       * @returns {boolean} Si el campo no corresponde al teléfono.
       */ (key) => !['countryCode', 'number'].includes(key),
    ) ||
    typeof value.countryCode !== 'string' ||
    typeof value.number !== 'string'
  )
    throw new ApplicationError(400, 'INVALID_REGISTRATION_PHONE');
  const countryCode = value.countryCode.trim().replace(/^\+/, '');
  const number      = value.number.trim();
  if (
    !/^[1-9][0-9]{0,2}$/.test(countryCode) ||
    !/^[0-9]{7,14}$/.test(number) ||
    countryCode.length + number.length > 15
  )
    throw new ApplicationError(400, 'INVALID_REGISTRATION_PHONE');
  return {
    countryCode,
    number,
  };
}
/** Conserva los nombres separados y limita el nombre preferido privado.
 * @param {Object|undefined} value Nombre del contacto.
 * @returns {Object|undefined} Copia normalizada sin alterar la entrada.
 * @throws {ApplicationError} Rechaza formas inválidas antes de producir efectos.
 */
function registrationName(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApplicationError(400, 'INVALID_NAME');
  const result = {};
  for (const key of Object.keys(value)) {
    if (
      !['firstName', 'lastNamePaternal', 'lastNameMaternal', 'preferredName'].includes(key) ||
      typeof value[key] !== 'string' ||
      value[key].length > (key === 'preferredName' ? 100 : 1000)
    )
      throw new ApplicationError(400, 'INVALID_NAME');
    result[key] = value[key].trim();
  }
  return result;
}
module.exports = {
  registrationPhone,
  registrationName,
};
