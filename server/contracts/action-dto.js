/** @file DTO comunes de frontera: estructuras vigentes, validación de entrada y serialización de salida. */
'use strict';
const { ApplicationError } = require('../shared/application-error');
const manifest             = require('./service.json');
const { assertSchema }     = require('./schema-definition');

/** Ordena claves para comparar elementos JSON por valor, sin depender del orden de sus propiedades.
 * @param {*} value Valor que debe compararse como parte de un arreglo único.
 * @returns {string} Representación estable para la igualdad estructural.
 */
function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        /**
         * Aplica la operación local y devuelve su resultado al flujo que la invoca.
         * @param {*} key Valor utilizado por la operación.
         * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
         */
        (key) => `${JSON.stringify(key)}:${stableValue(value[key])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value);
}

/**
 * Comprueba el subconjunto estructural declarado por los contratos públicos de este servicio.
 * Las reglas de autorización y de negocio siguen siendo responsabilidad del dominio.
 * @param {*} value Valor recibido desde el transporte o producido por el controlador.
 * @param {Object} schema Tipos, propiedades, límites y campos obligatorios permitidos.
 * @param {boolean} [root=true] Impide selectores de consumidor en la raíz de una solicitud.
 * @returns {boolean} Indica si el valor cumple la estructura declarada.
 */
function validateValue(value, schema, root = true) {
  if (!schema || !Object.keys(schema).length) return true;
  if (
    schema.oneOf &&
    schema.oneOf.filter(
      /**
       * Aplica la operación local y devuelve su resultado al flujo que la invoca.
       * @param {*} candidate Valor utilizado por la operación.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      (candidate) => validateValue(value, candidate, root),
    ).length !== 1
  )
    return false;
  if (
    schema.anyOf &&
    !schema.anyOf.some(
      /**
       * Aplica la operación local y devuelve su resultado al flujo que la invoca.
       * @param {*} candidate Valor utilizado por la operación.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      (candidate) => validateValue(value, candidate, root),
    )
  )
    return false;
  if (
    schema.allOf &&
    !schema.allOf.every(
      /**
       * Aplica la operación local y devuelve su resultado al flujo que la invoca.
       * @param {*} candidate Valor utilizado por la operación.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      (candidate) => validateValue(value, candidate, root),
    )
  )
    return false;
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type  = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (
    schema.type &&
    !types.includes(type) &&
    !(type === 'number' && Number.isInteger(value) && types.includes('integer'))
  )
    return false;
  if (
    schema.enum &&
    !schema.enum.some(
      /** @param {*} candidate Valor JSON permitido por la enumeración.
       * @returns {boolean} Igualdad estructural que no depende del orden de las claves.
       */
      (candidate) => stableValue(candidate) === stableValue(value),
    )
  )
    return false;
  if (
    type === 'number' &&
    (!Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    return false;
  if (
    type === 'string' &&
    ((schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength) ||
      (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)))
  )
    return false;
  if (
    type === 'array' &&
    ((schema.minItems !== undefined && value.length < schema.minItems) ||
      (schema.maxItems !== undefined && value.length > schema.maxItems) ||
      (schema.uniqueItems === true &&
        new Set(
          value.map(
            /**
             * Aplica la operación local y devuelve su resultado al flujo que la invoca.
             * @param {*} item Valor utilizado por la operación.
             * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
             */
            (item) => stableValue(item),
          ),
        ).size !== value.length) ||
      value.some(
        /**
         * Comprueba si el elemento satisface la condición.
         * @param {*} item Valor de item utilizado por esta operación.
         * @returns {boolean} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (item) => !validateValue(item, schema.items, false),
      ))
  )
    return false;
  if (type === 'object') {
    if (
      root &&
      ['consumer', 'consumerService', 'projection'].some(
        /**
         * Comprueba si el elemento satisface la condición.
         * @param {string} key Clave del campo o recurso que se procesa.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (key) => Object.hasOwn(value, key),
      )
    )
      return false;
    if (
      (schema.required || []).some(
        /**
         * Comprueba si el elemento satisface la condición.
         * @param {string} key Clave del campo o recurso que se procesa.
         * @returns {boolean} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (key) => !Object.hasOwn(value, key),
      )
    )
      return false;
    for (const [key, item] of Object.entries(value)) {
      if (schema.additionalProperties === false && !Object.hasOwn(schema.properties || {}, key))
        return false;
      if (item === undefined && !(schema.required || []).includes(key)) continue;
      if (Object.hasOwn(schema.properties || {}, key)) {
        if (!validateValue(item, schema.properties[key], false)) return false;
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        if (!validateValue(item, schema.additionalProperties, false)) return false;
      }
    }
  }
  return true;
}

/**
 * Valida datos únicamente contra definiciones soportadas; las configuraciones inválidas fallan explícitamente.
 * @param {*} value Datos que se comprueban sin convertirlos ni modificarlos.
 * @param {Object} schema Esquema estructural conocido.
 * @param {boolean} [root=true] Excluye selectores de consumidor en la raíz de solicitudes.
 * @returns {boolean} Cumplimiento de los datos; un esquema inválido produce TypeError.
 */
function validate(value, schema, root = true) {
  assertSchema(schema);
  return validateValue(value, schema, root);
}

/**
 * Construye los DTO de entrada y salida de un conjunto de acciones del mismo dominio.
 * Los esquemas vigentes son la fuente compartida por los DTO y el descubrimiento RPC.
 * @param {string[]} names Nombres canónicos de las acciones, eventos o comandos del dominio.
 * @returns {Object<string, Object>} DTO inmutables con esquemas, validación de entrada y salida pública.
 */
function createActionDtos(names) {
  const definitions = new Map(
    manifest.endpoints.map(
      /**
       * Aplica la operación local y devuelve su resultado al flujo que la invoca.
       * @param {*} definition Valor utilizado por la operación.
       * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
       */
      (definition) => [definition.name, definition],
    ),
  );
  const result      = Object.create(null);
  for (const name of names) {
    const definition = definitions.get(name);
    if (!definition) throw new Error('ACTION_DTO_CONTRACT_MISSING:' + name);
    assertSchema(definition.request, name + '.request');
    assertSchema(
      definition.response?.$ref === '#/responseEnvelope'
        ? manifest.responseEnvelope
        : definition.response,
      name + '.response',
    );
    if (definition.successData) assertSchema(definition.successData, name + '.successData');
    if (
      definition.dataByStatus !== undefined &&
      (!definition.dataByStatus ||
        typeof definition.dataByStatus !== 'object' ||
        Array.isArray(definition.dataByStatus))
    )
      throw new TypeError('INVALID_RESPONSE_STATUS_SCHEMA:' + name);
    if (definition.successStatuses !== undefined) {
      if (
        !Array.isArray(definition.successStatuses) ||
        new Set(definition.successStatuses).size !== definition.successStatuses.length
      )
        throw new TypeError('INVALID_SUCCESS_STATUSES:' + name);
      for (const status of definition.successStatuses)
        if (!Number.isInteger(status) || status < 100 || status >= 400)
          throw new TypeError('INVALID_SUCCESS_STATUSES:' + name);
    }
    for (const [status, schema] of Object.entries(definition.dataByStatus || {})) {
      if (!/^\d{3}$/.test(status) || Number(status) < 100 || Number(status) > 599)
        throw new TypeError('INVALID_RESPONSE_STATUS_SCHEMA:' + name);
      assertSchema(schema, name + '.dataByStatus.' + status);
    }
    result[name] = Object.freeze({
      name,
      inputSchema        : definition.request,
      outputSchema       :
        definition.response?.$ref === '#/responseEnvelope'
          ? manifest.responseEnvelope
          : definition.response,
      successDataSchema  : definition.successData,
      dataByStatusSchema : definition.dataByStatus,
      /**
       * Valida la entrada de transporte antes de ejecutar permisos y reglas de negocio del dominio.
       * @param {*} value Datos recibidos por la acción.
       * @returns {*} Entrada acreditada estructuralmente; conserva los campos de su contrato vigente.
       * @throws {ApplicationError} Si el contenido no cumple el esquema de entrada.
       */
      input(value) {
        const data = value === undefined ? {} : value;
        if (!validate(data, definition.request)) throw new ApplicationError(400, 'INVALID_INPUT');
        return data;
      },
      /**
       * Uniforma la respuesta pública y comprueba la proyección de éxito declarada.
       * Los comandos y eventos conservan su resultado interno de confirmación del transporte.
       * @param {*} value Resultado producido por el caso de uso.
       * @returns {*} Respuesta RPC normalizada o confirmación interna del comando o evento.
       * @throws {ApplicationError} Si el estado o los datos de salida incumplen el contrato.
       */
      output(value) {
        if (definition.kind === 'event' || definition.delivery === 'command') return value;
        const statusCode = Number(value?.statusCode);
        if (!Number.isInteger(statusCode) || statusCode < 100 || statusCode > 599)
          throw new ApplicationError(500, 'INVALID_SERVICE_RESPONSE');
        const data = value.data === undefined && statusCode < 400 ? {} : value.data;
        if (
          statusCode < 400 &&
          Array.isArray(definition.successStatuses) &&
          !definition.successStatuses.includes(statusCode)
        )
          throw new ApplicationError(500, 'INVALID_SERVICE_RESPONSE');
        const dataSchema =
          definition.dataByStatus?.[statusCode] ||
          (statusCode < 400 ? definition.successData : undefined);
        if (dataSchema && !validate(data, dataSchema, false))
          throw new ApplicationError(500, 'INVALID_SERVICE_RESPONSE');
        const response = {
          statusCode,
          descriptionCode : value.descriptionCode || (statusCode < 400 ? 'OK' : 'APPLICATION_ERROR'),
          ...(data === undefined ? {} : { data }),
        };
        const schema   =
          definition.response?.$ref === '#/responseEnvelope'
            ? manifest.responseEnvelope
            : definition.response;
        if (!validate(response, schema, false))
          throw new ApplicationError(500, 'INVALID_SERVICE_RESPONSE');
        return response;
      },
    });
  }
  return Object.freeze(result);
}
module.exports = {
  validate,
  createActionDtos,
};
