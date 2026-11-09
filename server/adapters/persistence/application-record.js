/** @file Conversión de documentos de persistencia a registros de aplicación sin comportamiento de Mongoose ni valores BSON. */
'use strict';

/**
 * Copia registros, arreglos y valores de MongoDB sin aplicar una proyección pública.
 * Conserva los campos privados necesarios dentro de Security; la frontera pública los selecciona.
 * No ejecuta consultas, no guarda documentos y no modifica el valor original.
 * @param {*} value Documento, registro, colección o valor devuelto por persistencia.
 * @returns {*} Copia de datos con identificadores hexadecimales y fechas ISO; null y undefined se conservan.
 */
function applicationRecord(value) {
  if (value === null || typeof value !== 'object') return value;
  if (value._bsontype === 'ObjectId') return value.toHexString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(applicationRecord);
  const source =
    typeof value.toObject === 'function'
      ? value.toObject({
          transform        : false,
          flattenMaps      : true,
          flattenObjectIds : true,
        })
      : value;
  const result = {};
  for (const [key, item] of Object.entries(source))
    Object.defineProperty(result, key, {
      value        : applicationRecord(item),
      enumerable   : true,
      writable     : true,
      configurable : true,
    });
  return result;
}

module.exports = { applicationRecord };
