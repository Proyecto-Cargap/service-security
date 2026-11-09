/** @file Cliente de la información central de Platform para usuarios, sesiones y correos. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');

/**
 * Obtiene el valor solicitado.
 * @param {Object} messaging Puerto de mensajería y contexto autenticado.
 * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
exports.get = async function get(messaging) {
  try {
    const response = await messaging.request(
      'service-platform',
      'configuration-get-information',
      {},
      { timeoutMs: 8000 },
    );
    const config   = response?.data;
    if (
      response?.statusCode !== 200 ||
      typeof config?.title !== 'string' ||
      !config.title.trim() ||
      typeof config.publicUrl !== 'string' ||
      typeof config.logos?.email !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(config.theme?.primary?.['900'] || '')
    )
      throw new Error('INVALID_PLATFORM_INFORMATION');
    const origin = new URL(config.publicUrl);
    const logo   = config.logos.email ? new URL(config.logos.email) : null;
    if (
      origin.origin !== config.publicUrl ||
      [origin, logo].filter(Boolean).some(
        /**
         * Comprueba si el elemento satisface la condición.
         * @param {*} url Valor de url utilizado por esta operación.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (url) => url.username || url.password || !['https:', 'http:'].includes(url.protocol),
      )
    )
      throw new Error('INVALID_PLATFORM_INFORMATION');
    return config;
  } catch (cause) {
    throw new ApplicationError(503, 'N0001-CONFIG-UNAVAILABLE', {
      cause,
      uncertain : cause?.uncertain === true,
    });
  }
};
