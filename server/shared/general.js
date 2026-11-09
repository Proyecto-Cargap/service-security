/**
 * @file Utilidades de identificación, ordenación y normalización compartidas por las operaciones del
 * servicio.
 */
'use strict';
const { ApplicationError } = require('./application-error');

/**
 * Completa con ceros a la izquierda la representación del valor hasta alcanzar la longitud solicitada.
 *
 * @param {number|string} num Valor cuya representación se completa con ceros.
 * @param {number} size Longitud mínima de la representación resultante.
 * @returns {string} Representación del valor con ceros a la izquierda.
 */
exports.pad = function pad(num, size) {
  let s = num + '';
  while (s.length < size) {
    s = '0' + s;
  }
  return s;
};

/**
 * Construye el orden de consulta usando el campo solicitado o el campo predeterminado y orden ascendente
 * cuando no se especifica.
 *
 * @param {string} field Nombre del campo utilizado por la operación.
 * @param {string|null} [requestedField] Campo de ordenación solicitado; null conserva el campo
 * predeterminado.
 * @param {string|null} [requestedOrder] Dirección de ordenación solicitada.
 * @returns {Object} Objeto de ordenación con el campo y la dirección efectivos.
 */
exports.getSortQuery = function getSortQuery(field, requestedField = null, requestedOrder = null) {
  const key = requestedField || field;
  if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_.]*$/.test(key))
    throw new ApplicationError(400, 'INVALID_SORT');
  const order = requestedOrder || 'asc';
  if (!['asc', 'desc', 1, -1].includes(order)) throw new ApplicationError(400, 'INVALID_SORT');
  return {
    [key] : order,
    ...(key === field ? {} : { [field]: 1 }),
  };
};

/**
 * Obtiene un valor desde caché o lo consulta si no existe y lo guarda.
 *
 * @param {Map} cache Mapa de caché para la entidad.
 * @param {string} key Clave a buscar (ej. jobCode, departmentCode...).
 * @param {function(string): Promise<any>} fetchFn Función async que recibe el código y retorna la
 * entidad.
 * @returns {Promise<null|any>} Resultado de la caché o de la consulta.
 */
exports.cachedEntity = async function cachedEntity(cache, key, fetchFn) {
  if (key === '') return null;
  if (cache.has(key)) {
    return cache.get(key);
  }
  const result = await fetchFn(key);
  cache.set(key, result);
  return result;
};

/**
 * Compara dos arreglos ordenando copias para ignorar el orden original sin modificar las entradas.
 *
 * @param {Array} a Arreglo que se compara sin modificar su orden original.
 * @param {Array} b Arreglo que se compara sin modificar su orden original.
 * @returns {boolean} true si ambas listas contienen los mismos elementos después de ordenar sus copias.
 */
exports.arraysAreEqual = function arraysAreEqual(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every(
    /**
     * Comprueba la condición requerida para cada elemento.
     * @param {*} val Valor de val utilizado por esta operación.
     * @param {*} i Valor de i utilizado por esta operación.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    (val, i) => val === sortedB[i],
  );
};

/**
 * Escapa metacaracteres para que el valor pueda utilizarse como texto literal dentro de una expresión
 * regular.
 *
 * @param {*} value Valor que se normaliza antes de utilizarlo en la operación.
 * @returns {string} Texto escapado para utilizarse como contenido literal en una expresión regular.
 */
exports.escapeRegex = function escapeRegex(value) {
  const normalized = value == null ? '' : String(value);
  return normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

/**
 * Valida la paginación pública y convierte la página de base uno a base cero para persistencia.
 * @param {Object} [input] Entrada con page y perPage opcionales; admite valores numéricos de transporte.
 * @returns {{page: number, perPage: number}} Página interna y tamaño; cero indica ausencia de límite.
 * @throws {ApplicationError} INVALID_PAGINATION si un valor no es entero o está fuera de rango.
 */
function getPagination(input = {}) {
  for (const key of ['page', 'perPage']) {
    if (
      input[key] !== undefined &&
      (!Number.isInteger(Number(input[key])) ||
        Number(input[key]) < (key === 'page' ? 1 : 0) ||
        Number(input[key]) > 10000)
    )
      throw new ApplicationError(400, 'INVALID_PAGINATION');
  }
  const perPage = parseInt(input.perPage) || 0;
  const page    = (parseInt(input.page) || 1) - 1;
  return {
    page,
    perPage,
  };
}

exports.getPagination = getPagination;

/** Paginación pública acotada; las lecturas internas completas usan un contrato separado.
 * @param {Object} [input] Entrada que se procesa con las reglas del módulo.
 * @returns {Object} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
function getPublicPagination(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new ApplicationError(400, 'INVALID_PAGINATION');
  const values = {};
  for (const [key, fallback, maximum] of [
    ['page', 1, 10000],
    ['perPage', 20, 100],
  ]) {
    const value = input[key] === undefined ? fallback : input[key];
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && !/^\d+$/.test(value)) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 ||
      Number(value) > maximum
    )
      throw new ApplicationError(400, 'INVALID_PAGINATION');
    values[key] = Number(value);
  }
  return {
    page    : values.page - 1,
    perPage : values.perPage,
  };
}
module.exports.getPublicPagination = getPublicPagination;

/** Recorre un contrato público por lotes; falla si cambian conteos o falta una página.
 * @param {*} readPage Valor de readPage utilizado por esta operación.
 * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
exports.collectPages = async function collectPages(readPage) {
  const items = [];
  let total;
  for (let page = 1; page <= 10000; page++) {
    const result = await readPage({
      page,
      perPage : 100,
    });
    const meta   = result?.pagination;
    if (
      !meta ||
      !Array.isArray(result.items) ||
      !Number.isSafeInteger(meta.total) ||
      meta.total < 0 ||
      meta.page !== page ||
      meta.perPage !== 100 ||
      (total !== undefined && total !== meta.total) ||
      result.items.length !== Math.min(100, Math.max(0, meta.total - items.length))
    )
      throw new ApplicationError(409, 'PAGINATION_CHANGED');
    total = meta.total;
    items.push(...result.items);
    if (items.length === total)
      return {
        items,
        pagination : {
          total,
          page    : 1,
          perPage : items.length,
        },
      };
  }
  throw new ApplicationError(400, 'COLLECTION_TOO_LARGE');
};
