/** @file Comprueba las definiciones del subconjunto de esquemas soportado; una palabra desconocida impide iniciar el catálogo. */
'use strict';

const KEYWORDS = new Set([
  'type',
  'enum',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'pattern',
  'oneOf',
  'anyOf',
  'allOf',
  'description',
  'title',
  '$comment',
]);
const TYPES    = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

/**
 * Rechaza configuraciones que el validador no puede interpretar y límites contradictorios.
 * Los objetos vacíos se reservan para cargas extensibles declaradas expresamente por el contrato.
 * No resuelve referencias ni aplica valores predeterminados, conversiones o formatos implícitos.
 * @param {Object} schema Definición JSON del contrato.
 * @param {string} [location='schema'] Ubicación diagnóstica sin datos de solicitudes.
 * @returns {void} Finaliza si toda la definición es soportada y consistente.
 * @throws {TypeError} Cuando hay palabras desconocidas o una estructura no soportada.
 */
function assertSchema(schema, location = 'schema') {
  /**
   * Señala la parte inválida del contrato sin incluir contenido de solicitudes.
   * @param {string} keyword Propiedad cuya definición debe corregirse.
   * @returns {never} Interrumpe la construcción del catálogo.
   */
  function invalid(keyword) {
    throw new TypeError(`INVALID_SCHEMA:${location}.${keyword}`);
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) invalid('definition');
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) invalid(key);
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.length || new Set(types).size !== types.length) invalid('type');
    for (const type of types) if (!TYPES.has(type)) invalid('type');
  }
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length))
    invalid('enum');
  if (schema.properties !== undefined) {
    if (
      !schema.properties ||
      typeof schema.properties !== 'object' ||
      Array.isArray(schema.properties)
    )
      invalid('properties');
    for (const [key, value] of Object.entries(schema.properties))
      assertSchema(value, `${location}.properties.${key}`);
  }
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length)
      invalid('required');
    for (const key of schema.required) {
      if (
        typeof key !== 'string' ||
        (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key))
      )
        invalid('required');
    }
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== 'boolean'
  ) {
    assertSchema(schema.additionalProperties, `${location}.additionalProperties`);
  }
  if (schema.items !== undefined) assertSchema(schema.items, `${location}.items`);
  for (const key of ['minimum', 'maximum']) {
    if (
      schema[key] !== undefined &&
      (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))
    )
      invalid(key);
  }
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || schema[key] < 0))
      invalid(key);
  }
  for (const [minimum, maximum] of [
    ['minimum', 'maximum'],
    ['minLength', 'maxLength'],
    ['minItems', 'maxItems'],
  ]) {
    if (
      schema[minimum] !== undefined &&
      schema[maximum] !== undefined &&
      schema[minimum] > schema[maximum]
    )
      invalid(maximum);
  }
  if (schema.uniqueItems !== undefined && typeof schema.uniqueItems !== 'boolean')
    invalid('uniqueItems');
  if (schema.pattern !== undefined) {
    if (typeof schema.pattern !== 'string') invalid('pattern');
    try {
      new RegExp(schema.pattern, 'u');
    } catch {
      invalid('pattern');
    }
  }
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (schema[key] === undefined) continue;
    if (!Array.isArray(schema[key]) || !schema[key].length) invalid(key);
    for (const value of schema[key]) assertSchema(value, `${location}.${key}`);
  }
  for (const key of ['description', 'title', '$comment']) {
    if (schema[key] !== undefined && typeof schema[key] !== 'string') invalid(key);
  }
}

module.exports = { assertSchema };
