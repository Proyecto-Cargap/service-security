/** @file Conformidad del validador de esquemas: alternativas, límites y unicidad estructural. */
'use strict';
const test             = require('node:test');
const assert           = require('node:assert/strict');
const { validate }     = require('../server/contracts/action-dto');
const { assertSchema } = require('../server/contracts/schema-definition');

/**
 * Comprueba configuraciones que antes podían pasar inadvertidas por el validador.
 * @returns {void} Finaliza al rechazar palabras desconocidas y esquemas inconsistentes.
 */
function verifySchemaDefinitions() {
  for (const schema of [
    {
      type                : 'object',
      additionalPropertes : false,
    },
    {
      type   : 'string',
      format : 'email',
    },
    { type: 'unknown' },
    { type: [] },
    { minItems: -1 },
    {
      minLength : 3,
      maxLength : 2,
    },
    {
      minimum : 10,
      maximum : 1,
    },
    {
      type    : 'string',
      pattern : '[',
    },
    { properties: { nested: { unsupported: true } } },
    { oneOf: [] },
    {
      type                 : 'object',
      required             : ['missing'],
      additionalProperties : false,
    },
    { additionalProperties: 'true' },
    { uniqueItems: 1 },
    { items: false },
    { $ref: '#/unknown' },
  ]) {
    /** @returns {boolean} Resultado que nunca debe obtenerse con un esquema inválido. */
    function invalidDefinition() {
      return validate({}, schema);
    }
    assert.throws(invalidDefinition, /INVALID_SCHEMA:/);
  }
  assertSchema({
    type                 : 'object',
    properties           : { value: { type: 'string' } },
    additionalProperties : false,
  });
  const dictionary = {
    type                 : 'object',
    additionalProperties : {
      type    : 'integer',
      minimum : 0,
    },
  };
  assert.equal(
    validate(
      {
        first  : 0,
        second : 2,
      },
      dictionary,
    ),
    true,
  );
  assert.equal(validate({ first: 'invalid' }, dictionary), false);
  assert.equal(validate(JSON.parse('{"__proto__":-1}'), dictionary), false);
}

test(
  'las definiciones inválidas fallan explícitamente y los mapas validan cada valor',
  verifySchemaDefinitions,
);
test('las alternativas, patrones y arreglos únicos conservan la semántica declarada' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, () => {
  assert.equal(
    validate('abc', {
      type    : 'string',
      pattern : '^a',
    }),
    true,
  );
  assert.equal(
    validate('other', {
      type    : 'string',
      pattern : '^a',
    }),
    false,
  );
  assert.equal(validate(1, { oneOf: [{ type: 'number' }, { type: 'integer' }] }), false);
  assert.equal(validate('x', { oneOf: [{ type: 'number' }, { type: 'string' }] }), true);
  assert.equal(validate(true, { anyOf: [{ type: 'number' }, { type: 'string' }] }), false);
  assert.equal(validate(4, { allOf: [{ type: 'integer' }, { minimum: 5 }] }), false);
  const schema = {
    type        : 'array',
    minItems    : 1,
    uniqueItems : true,
    items       : { type: 'object' },
  };
  assert.equal(validate([], schema), false);
  assert.equal(
    validate(
      [
        {
          a : 1,
          b : 2,
        },
        {
          b : 2,
          a : 1,
        },
      ],
      schema,
    ),
    false,
  );
  assert.equal(validate([{ a: 1 }, { a: 2 }], schema), true);
  assert.equal(
    validate(
      {
        b : 2,
        a : 1,
      },
      {
        enum : [
          {
            a : 1,
            b : 2,
          },
        ],
      },
    ),
    true,
  );
  assert.equal(
    validate(
      {
        a : 2,
        b : 2,
      },
      {
        enum : [
          {
            a : 1,
            b : 2,
          },
        ],
      },
    ),
    false,
  );
});
