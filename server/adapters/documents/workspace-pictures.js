/** @file Adaptador de imágenes de workspaces al contrato canónico de Documents; convierte respuestas remotas en datos de aplicación. */
'use strict';
const { ApplicationError }         = require('../../shared/application-error');
const { publicRecord }             = require('../../shared/public-record');
const { PICTURE_REFERENCE_FIELDS } = require('../../modules/security/ports/security-pictures.port');

/**
 * Construye las operaciones técnicas de imagen para un workspace ya autorizado.
 * @param {Object} dependencies Mensajería y logger del dominio.
 * @returns {Object} Carga de variantes y limpieza de imágenes propias.
 */
module.exports = function workspacePicturesAdapter({ messaging, logger }) {
  /**
   * Invoca el puerto remoto conservando el contexto y las opciones de entrega.
   * @param {*} operation Valor de operation utilizado por esta operación.
   * @param {Object} data Datos de entrada de la operación.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function request(operation, data) {
    const result = await messaging.request(
      'service-documents',
      `files-storage-${operation}`,
      data,
      { timeoutMs: 310000 },
    );
    if (!Number.isInteger(result?.statusCode) || result.statusCode < 100 || result.statusCode > 599)
      throw new ApplicationError(502, 'INVALID_STORAGE_RESPONSE', { uncertain: true });
    if (result.statusCode < 200 || result.statusCode >= 300)
      throw new ApplicationError(result.statusCode, result.descriptionCode, {
        uncertain : result.statusCode >= 500,
      });
    return result.data;
  }
  return {
    /**
     * @param {Object} upload Temporal y opciones preparados por el gateway.
     * @param {string} resourceCode Código del workspace autorizado.
     * @param {string} workspace Ámbito verificado del registro.
     * @returns {Promise<Object>} Referencia pública y tamaños generados.
     */
    async upload(upload, resourceCode, workspace) {
      if (upload.visibility !== 'public' || upload.generateVariants !== true)
        throw new ApplicationError(400, 'INVALID_WORKSPACE_IMAGE_OPTIONS');
      const reference = await request('upload', {
        ...upload,
        resourceCode,
        resourceType : 'workspace-picture',
        workspace,
        image        : true,
      });
      if (
        !reference ||
        typeof reference.id !== 'string' ||
        !reference.id ||
        typeof reference.url !== 'string' ||
        !reference.url
      )
        throw new ApplicationError(502, 'INVALID_STORAGE_REFERENCE', { uncertain: true });
      return {
        picture     : reference.url,
        pictureFile : publicRecord(reference, PICTURE_REFERENCE_FIELDS),
      };
    },
    /**
     * @param {string} fileId Identificador técnico del archivo.
     * @param {string} resourceCode Workspace propietario de la imagen.
     * @returns {Promise<boolean>} Indica si se completó la limpieza.
     */
    async remove(fileId, resourceCode) {
      if (!fileId) return true;
      try {
        await request('delete', {
          fileId,
          resourceType : 'workspace-picture',
          resourceCode,
        });
        return true;
      } catch {
        logger.error({
          component : 'workspace_picture',
          event     : 'cleanup_pending',
          code      : 'FILE_CLEANUP_PENDING',
        });
        return false;
      }
    },
  };
};
