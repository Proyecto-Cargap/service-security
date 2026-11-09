/** @file Recuperación de cargas y limpieza pendiente de imágenes de espacios de trabajo; conserva entradas, resultados, errores y efectos existentes. */
'use strict';
/** Compone exclusivamente esta capacidad con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas; no se construyen conexiones ni SDK.
 * @returns {Object} Funciones del contrato interno vigente.
 */
function workspacePictureRecoveryService({ pictures, workspacesRepository, workspacesScopes }) {
  /**
   * Ejecuta recoverUpload dentro del flujo de workspaces.service.
   * @param {*} uploaded Valor de uploaded utilizado por esta operación.
   * @param {*} resourceCode Valor de resourceCode utilizado por esta operación.
   * @param {Error} error Fallo recibido por la continuación.
   * @returns {Promise<boolean>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function recoverUpload(uploaded, resourceCode, error) {
    if (!uploaded) return false;
    try {
      const current = await workspacesRepository.getOne(
        { workspaceCode: resourceCode },
        workspacesScopes.guest,
      );
      if (current?.pictureFile?.id === uploaded.pictureFile.id) return true;
      if (!(await pictures.remove(uploaded.pictureFile.id, resourceCode))) error.uncertain = true;
    } catch {
      error.uncertain = true;
    }
    return false;
  }
  return {
    recoverUpload,
  };
}
module.exports = { workspacePictureRecoveryService };
