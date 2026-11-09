/** @file Conformidad del adaptador canónico de imágenes: datos de aplicación, errores e incertidumbre sin efectos durante composición. */
'use strict';
const test           = require('node:test');
const assert         = require('node:assert/strict');
const createPictures = require('../server/adapters/documents/workspace-pictures');

/**
 * Crea únicamente el límite de prueba de mensajería y observa entradas y resultados.
 * @returns {Object} Adaptador, solicitudes y control del siguiente resultado remoto.
 */
function fixture() {
  const calls     = [];
  const events    = [];
  const reference = {
    id          : 'f',
    name        : 'fixture.png',
    mimeType    : 'image/png',
    url         : '/files/public/v1/f',
    size        : 10,
    visibility  : 'public',
    sizes       : ['original', '100'],
    sdkMetadata : 'private-fixture',
  };
  let response    = {
    statusCode : 201,
    data       : reference,
  };
  /** @param {string} service Destinatario canónico de almacenamiento.
   * @param {string} action Acción RPC explícita.
   * @param {Object} data Recurso y opciones ya autorizados por Security.
   * @param {Object} options Plazo de transferencia conservado.
   * @returns {Promise<Object>} Resultado controlado sin conexiones de red.
   */
  async function request(service, action, data, options) {
    calls.push({
      service,
      action,
      data,
      options,
    });
    if (response instanceof Error) throw response;
    return response;
  }
  /** @param {Object} event Registro técnico redactado por el adaptador.
   * @returns {void} Conserva únicamente los datos que observa la prueba.
   */
  function error(event) {
    events.push(event);
  }
  /** @param {*} value Resultado o fallo de la siguiente operación remota.
   * @returns {void} Cambia sólo el puerto simulado de la prueba.
   */
  function result(value) {
    response = value;
  }
  return {
    pictures : createPictures({
      messaging : { request },
      logger    : { error },
    }),
    calls,
    events,
    reference,
    result,
  };
}

/** @returns {Promise<void>} Acredita carga canónica y selección positiva sin campos del SDK. */
async function verifyCanonicalUpload() {
  const data = fixture();
  assert.equal(data.calls.length, 0);
  const upload = {
    fileId           : 'f',
    name             : 'fixture.png',
    tempFilePath     : '/fixture/upload.png',
    visibility       : 'public',
    generateVariants : true,
  };
  const result = await data.pictures.upload(upload, 'w', 'w');
  assert.equal(result.picture, data.reference.url);
  assert.equal(result.pictureFile.sdkMetadata, undefined);
  assert.notEqual(result.pictureFile.sizes, data.reference.sizes);
  assert.deepEqual(data.calls, [
    {
      service : 'service-documents',
      action  : 'files-storage-upload',
      data    : {
        ...upload,
        resourceCode : 'w',
        resourceType : 'workspace-picture',
        workspace    : 'w',
        image        : true,
      },
      options : { timeoutMs: 310000 },
    },
  ]);
}

/** @returns {Promise<void>} Rechaza opciones inválidas antes del efecto y conserva la incertidumbre de respuestas remotas. */
async function verifyUploadFailures() {
  const data = fixture();
  await assert.rejects(
    data.pictures.upload(
      {
        visibility       : 'private',
        generateVariants : true,
      },
      'w',
      'w',
    ),
    { statusCode: 400 },
  );
  assert.equal(data.calls.length, 0);
  const upload = {
    visibility       : 'public',
    generateVariants : true,
  };
  data.result({
    statusCode      : 403,
    descriptionCode : 'FORBIDDEN',
  });
  await assert.rejects(data.pictures.upload(upload, 'w', 'w'), {
    statusCode      : 403,
    descriptionCode : 'FORBIDDEN',
  });
  data.result({
    statusCode      : 503,
    descriptionCode : 'STORAGE_WRITE_UNCERTAIN',
  });
  await assert.rejects(data.pictures.upload(upload, 'w', 'w'), {
    statusCode : 503,
    uncertain  : true,
  });
  data.result(undefined);
  await assert.rejects(data.pictures.upload(upload, 'w', 'w'), {
    statusCode : 502,
    uncertain  : true,
  });
  data.result({
    statusCode : 201,
    data       : {},
  });
  await assert.rejects(data.pictures.upload(upload, 'w', 'w'), {
    statusCode : 502,
    uncertain  : true,
  });
}

/** @returns {Promise<void>} Conserva la limpieza pendiente y nunca registra excepciones externas ni credenciales. */
async function verifyCleanupFailures() {
  const data = fixture();
  assert.equal(await data.pictures.remove('', 'w'), true);
  assert.equal(data.calls.length, 0);
  data.result(new Error('private-fixture'));
  assert.equal(await data.pictures.remove('f', 'w'), false);
  assert.equal(JSON.stringify(data.events).includes('private-fixture'), false);
  assert.deepEqual(data.calls[0].data, {
    fileId       : 'f',
    resourceType : 'workspace-picture',
    resourceCode : 'w',
  });
  data.result({
    statusCode : 200,
    data       : {},
  });
  assert.equal(await data.pictures.remove('f', 'w'), true);
}

test(
  'la carga de imagen usa el contrato canónico y devuelve sólo datos de aplicación',
  verifyCanonicalUpload,
);
test(
  'las cargas inválidas o sin confirmación conservan sus errores e incertidumbre',
  verifyUploadFailures,
);
test(
  'el borrado conserva la limpieza pendiente sin revelar errores remotos',
  verifyCleanupFailures,
);
