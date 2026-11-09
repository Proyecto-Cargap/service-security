/** @file Puerto de imágenes de workspaces; el caso de uso recibe almacenamiento ya compuesto, sin construir clientes remotos. */
'use strict';

/**
 * @typedef {Object} WorkspacePictures
 * @property {function(Object, string, string):Promise<{picture:string,pictureFile:Object}>} upload Recibe temporal autorizado, identificador de recurso y espacio. Exige visibilidad pública y variantes. Devuelve URL y referencia canónica con id, sin documentos ni respuestas del proveedor. Una respuesta remota fallida conserva su estado y la señal uncertain; no realiza reintentos ciegos.
 * @property {function(string, string):Promise<boolean>} remove Retira únicamente el archivo del recurso indicado; true significa confirmación de borrado, false significa limpieza pendiente. Un identificador vacío ya está limpio. Los fallos de transporte se registran sin credenciales y devuelven false; el caso de recuperación conserva la incertidumbre.
 */

const PICTURE_CAPABILITIES     = Object.freeze(['upload', 'remove']);
const PICTURE_REFERENCE_FIELDS = Object.freeze([
  'id',
  'name',
  'mimeType',
  'url',
  'size',
  'visibility',
  'sizes',
]);

module.exports = {
  PICTURE_CAPABILITIES,
  PICTURE_REFERENCE_FIELDS,
};
