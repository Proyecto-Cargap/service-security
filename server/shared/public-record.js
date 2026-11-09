/** @file Proyecciones positivas de registros y páginas; sólo seleccionan datos, sin consultar ni modificar persistencia. */
'use strict';

/**
 * Selecciona campos conocidos y conserva los campos ausentes de proyecciones parciales.
 * @param {Object|null} record Registro de aplicación autorizado.
 * @param {string[]} fields Campos del contrato público de este recurso.
 * @returns {Object|null} Copia superficial positiva, con arreglos independientes e identificador textual.
 */
function publicRecord(record, fields) {
  if (!record) return null;
  const result = {};
  for (const field of fields) {
    const value = record[field];
    if (value === undefined) continue;
    result[field] = field === '_id' ? String(value) : Array.isArray(value) ? [...value] : value;
  }
  return result;
}

/**
 * Conserva exclusivamente los metadatos públicos y proyecta los elementos autorizados de la página.
 * @param {Object} page Página con pagination e items.
 * @param {Function} presenter Proyección pura de cada registro del recurso.
 * @returns {Object} Página que conserva total, página y tamaño sin añadir filtros por consumidor.
 */
function publicPage(page, presenter) {
  return {
    pagination : publicRecord(page.pagination, ['total', 'page', 'perPage']),
    items      : page.items.map(presenter),
  };
}

module.exports = {
  publicRecord,
  publicPage,
};
