/** @file Casos de uso de configuración de Security; separa consultas, actualización y avisos del transporte RPC. */
'use strict';
const { ApplicationError }    = require('../../../shared/application-error');
const { getPublicPagination } = require('../../../shared/general');
const { id }                  = require('../../../../package.json');
const { PARAMETERS }          = require('../contracts/settings.contract');

/**
 * Compone lecturas y cambios de configuración con persistencia y publicación explícitas.
 * @param {Object} dependencies Repositorio de parámetros y publicador durable ya construidos.
 * @returns {Object} Operaciones de aplicación; construirlas no consulta ni publica datos.
 */
function settingsService({ settings, messaging, roleDefaults }) {
  return {
    /**
     * Lee un parámetro visible sin exponer un documento de persistencia.
     * @param {Object} data Parámetro y alcance de autorización solicitados.
     * @returns {Promise<Object>} Registro de configuración autorizado.
     * @throws {ApplicationError} Conserva errores de entrada, ausencia y autorización existentes.
     */
    async getOne(data) {
      try {
        if (data.parameter === undefined)
          throw new ApplicationError(400, `${id}-C000-E0001:Parameter is required`);
        if (!Object.hasOwn(PARAMETERS, data.parameter))
          throw new ApplicationError(400, 'INVALID_PARAMETER');
        const result = await settings.get(
          data.parameter,
          data.scope === undefined ? '' : data.scope,
        );
        if (!result) throw new ApplicationError(400, `${id}-C000-E0002:Settings does not exist`);
        return result;
      } catch (cause) {
        if (cause?.statusCode) throw cause;
        throw new ApplicationError(500, 'APPLICATION_FAILED');
      }
    },
    /**
     * Consulta únicamente los parámetros del catálogo vigente y valida la paginación pública.
     * @param {Object} data Alcance y parámetros opcionales de página pública.
     * @returns {Promise<Object[]>} Parámetros autorizados, sin documentos Mongoose.
     */
    async getList(data) {
      getPublicPagination(data);
      try {
        const records = await settings.getAll(data.scope === undefined ? '' : data.scope);
        return records.filter(
          /** @param {Object} record Parámetro autorizado por persistencia.
           * @returns {boolean} Selecciona el catálogo canónico de configuración.
           */
          (record) => Object.hasOwn(PARAMETERS, record.parameter),
        );
      } catch (cause) {
        if (cause?.statusCode) throw cause;
        throw new ApplicationError(500, 'APPLICATION_FAILED');
      }
    },
    /**
     * Actualiza un parámetro; el repositorio confirma revisión y evento en una única transacción.
     * @param {Object} data Parámetro, cambios y alcance solicitados.
     * @returns {Promise<void>} Finaliza cuando se confirma la transacción; no devuelve datos técnicos.
     * @throws {ApplicationError} Propaga fallos transaccionales sin repetir la operación.
     */
    async update(data) {
      try {
        if (!data.parameter)
          throw new ApplicationError(400, `${id}-C000-E0001:Parameter is required`);
        if (!data.data) throw new ApplicationError(400, `${id}-C000-E0003:Data is required`);
        if (Object.hasOwn(data.data, 'defaultGroupsByRole')) {
          const context = messaging.getContext();
          if (
            !context.user?.userCode ||
            !context.policies?.includes('security.settings.update.global') ||
            (data.scope !== undefined && data.scope !== '' && data.scope !== 'global')
          )
            throw new ApplicationError(403, 'FORBIDDEN');
          if (data.parameter !== 'user-setings')
            throw new ApplicationError(400, 'INVALID_SETTINGS_FIELD');
          await roleDefaults.validate(data.data.defaultGroupsByRole);
        }
        const result = await settings.update(
          data.parameter,
          data.data,
          data.scope === undefined ? '' : data.scope,
          data.expectedRevision,
        );
        if (!result) throw new ApplicationError(400, `${id}-C000-E0002:Settings does not exist`);
      } catch (cause) {
        if (cause?.statusCode) {
          throw cause;
        }
        throw new ApplicationError(500, 'APPLICATION_FAILED', {
          cause,
        });
      }
    },
  };
}

module.exports = { settingsService };
