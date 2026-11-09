/** @file Pruebas del control arquitectónico con fuentes aisladas; nunca cargan el código inspeccionado. */
'use strict';
const test                = require('node:test');
const assert              = require('node:assert/strict');
const fs                  = require('node:fs');
const os                  = require('node:os');
const path                = require('node:path');
const { analyze, cycles } = require('../ops/check-architecture.cjs');

/** Construye fuentes de prueba y limpia únicamente su propio directorio temporal.
 * @param {Object} sources Mapa de archivos y contenidos.
 * @param {Function} work Comprobaciones que reciben la raíz temporal.
 * @returns {void} Propaga fallos de la comprobación después de limpiar.
 */
function fixture(sources, work) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-architecture-'));
  try {
    for (const [filename, source] of Object.entries(sources)) {
      const target = path.join(root, filename);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, source);
    }
    work(root);
  } finally {
    fs.rmSync(root, {
      recursive : true,
      force     : true,
    });
  }
}

/**
 * Comprueba que una utilidad compartida no pueda ocultar dependencias prohibidas del núcleo.
 * @returns {void} Finaliza al verificar rutas indirectas sin ejecutar código con efectos.
 */
function verifyIndirectDependencies() {
  /** @param {string} root Directorio de fuentes aisladas.
   * @returns {void} Comprueba la trazabilidad de cada infracción al caso de uso que la alcanza.
   */
  function verify(root) {
    const result = analyze(root);
    assert.equal(result.passed, false);
    const rules = new Set();
    for (const finding of result.findings) {
      rules.add(finding.rule);
      if (!finding.rule.startsWith('indirect-')) continue;
      assert.equal(finding.file, 'server/modules/example/services/example.service.js');
      assert.equal(finding.dependencyPath[0], finding.file);
    }
    for (const rule of [
      'indirect-environment-in-core',
      'indirect-io-in-core',
      'indirect-implementation-in-core',
      'indirect-package-in-core',
    ])
      assert.equal(rules.has(rule), true, rule);
  }
  fixture(
    {
      'server/modules/example/services/example.service.js'        :
        "throw Error('NO EJECUTAR'); require('../../../shared/helper');",
      'server/shared/helper.js'                                   :
        "const { env } = process; require('node:fs'); require('mongoose'); require('../modules/example/repositories/example.repository');",
      'server/modules/example/repositories/example.repository.js' : 'module.exports = {};',
    },
    verify,
  );
}

/**
 * Rechaza contratos de colaboradores que devuelven documentos o constructores técnicos al núcleo.
 * @returns {void} Finaliza al verificar modelos y clientes técnicos inyectados.
 */
function verifyTechnicalShapes() {
  /** @param {string} root Directorio de la prueba de arquitectura.
   * @returns {void} Comprueba ambas clases de dependencia técnica.
   */
  function verify(root) {
    const rules = new Set();
    for (const finding of analyze(root).findings) rules.add(finding.rule);
    assert.equal(rules.has('technical-construction-in-core'), true);
    assert.equal(rules.has('persistence-shape-in-core'), true);
  }
  fixture(
    {
      'server/modules/example/services/example.service.js' :
        'module.exports = deps => { const { Factory } = deps; const a = new Factory(); const client = new deps.Client(); return deps.document.toObject(); };',
    },
    verify,
  );
}

test(
  'detecta implementaciones, entorno y SDK ocultos en dependencias indirectas',
  verifyIndirectDependencies,
);
test(
  'impide construir clientes inyectados y consumir documentos del SDK en el núcleo',
  verifyTechnicalShapes,
);

test('detecta repositorios, SDK y entorno en casos de uso sin ejecutar sus fuentes' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, () => {
  fixture(
    {
      'server/modules/example/services/example.service.js'        :
        "throw Error('NO EJECUTAR'); const repository = require('../repositories/example.repository'); const sdk = require('mongoose'); const value = process['env'].SECRET;",
      'server/modules/example/repositories/example.repository.js' : 'module.exports = {};',
    },
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} root Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (root) => {
      const result = analyze(root);
      assert.equal(result.passed, false);
      assert.deepEqual(
        result.findings
          .map(
            /**
             * Aplica la operación local y devuelve su resultado al flujo que la invoca.
             * @param {*} item Valor utilizado por la operación.
             * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
             */
            (item) => item.rule,
          )
          .sort(),
        ['environment-in-core', 'implementation-in-core', 'package-in-core'],
      );
      assert.ok(
        result.findings.every(
          /**
           * Aplica la operación local y devuelve su resultado al flujo que la invoca.
           * @param {*} item Valor utilizado por la operación.
           * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
           */
          (item) => item.line === 1,
        ),
      );
    },
  );
});

test('permite construir implementaciones exclusivamente desde composición' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, () => {
  fixture(
    {
      'server/modules/example/services/example.service.js'         :
        'module.exports = ({ repository }) => ({ read: () => repository.read() });',
      'server/modules/example/compositions/example.composition.js' :
        "const model = require('mongoose'); module.exports = require('../services/example.service');",
      'server/library/vendor.js'                                   : "require('./missing');",
    },
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} root Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (root) => {
      const result = analyze(root);
      assert.equal(result.passed, true);
      assert.equal(result.components.length, 2);
    },
  );
});

test('detecta ciclos, autoimportaciones e importaciones sin destino' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, () => {
  assert.deepEqual(
    cycles(
      new Map([
        ['a', ['b']],
        ['b', ['a']],
        ['c', ['c']],
        ['d', []],
      ]),
    ),
    [['a', 'b'], ['c']],
  );
  fixture(
    {
      'server/modules/example/services/a.service.js' :
        "require('./b.service'); require('./absent');",
      'server/modules/example/services/b.service.js' : "require('./a.service');",
    },
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} root Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (root) => {
      const result = analyze(root);
      assert.equal(result.cycles.length, 1);
      assert.equal(
        result.findings.filter(
          /**
           * Aplica la operación local y devuelve su resultado al flujo que la invoca.
           * @param {*} item Valor utilizado por la operación.
           * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
           */
          (item) => item.rule === 'missing-import',
        ).length,
        1,
      );
      assert.equal(
        result.findings.filter(
          /**
           * Aplica la operación local y devuelve su resultado al flujo que la invoca.
           * @param {*} item Valor utilizado por la operación.
           * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
           */
          (item) => item.rule === 'dependency-cycle',
        ).length,
        1,
      );
    },
  );
});

test('impide persistencia en controladores y dependencias concretas en puertos' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, () => {
  fixture(
    {
      'server/modules/example/controllers/example.controller.js' :
        "require('../models/example.model');",
      'server/modules/example/ports/example.port.js'             : "require('../services/example.service');",
      'server/modules/example/services/example.service.js'       : 'require(`../${name}`);',
      'server/modules/example/models/example.model.js'           : 'module.exports = {};',
    },
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} root Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (root) => {
      assert.deepEqual(
        analyze(root)
          .findings.map(
            /**
             * Aplica la operación local y devuelve su resultado al flujo que la invoca.
             * @param {*} item Valor utilizado por la operación.
             * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
             */
            (item) => item.rule,
          )
          .sort(),
        ['dynamic-import', 'implementation-in-controller', 'implementation-in-port'],
      );
    },
  );
});

/** Una carpeta de dominio puede llamarse repositories sin representar una implementación técnica. */
test('distingue el dominio documental repositories de la capa de persistencia' /**
 * Aplica la operación local y devuelve su resultado al flujo que la invoca.
 * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
 */, () => {
  fixture(
    {
      'server/modules/documents/services/documents.service.js'      :
        "require('../../repositories/policies/repositories.policy');",
      'server/modules/repositories/policies/repositories.policy.js' : 'module.exports = {};',
    },
    /**
     * Aplica la operación local y devuelve su resultado al flujo que la invoca.
     * @param {*} root Valor utilizado por la operación.
     * @returns {*} Resultado de la operación; los fallos se propagan al flujo invocador.
     */
    (root) => assert.equal(analyze(root).passed, true),
  );
});
