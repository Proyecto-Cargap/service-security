/** @file Autoriza la acreditación de revisiones de agentes sin modificar consultas ni representaciones por consumidor. */
'use strict';
const { ApplicationError } = require('../../../shared/application-error');
const REVISION_AUTHORITIES = new Set(['service-intelligence', 'service-communication']);

/**
 * Valida una revisión acreditada mediante una capacidad de transporte autorizada.
 * Intelligence acredita su estado local y Communication conserva la acreditación de su RPC privado;
 * los demás servicios usan la comprobación autoritativa sin aportar esta capacidad.
 * @param {Object} data Credencial y revisión opcional, bajo el mismo contrato para todos los emisores.
 * @param {string} source Identidad del servicio acreditada por el transporte, no por el payload.
 * @param {number} credentialRevision Revisión de la credencial ya verificada criptográficamente.
 * @returns {number|undefined} Revisión autorizada; ausencia solicita la comprobación autoritativa común.
 * @throws {ApplicationError} 403 si no se dispone de la capacidad o la revisión no coincide.
 */
function agentRevisionAttestation(data, source, credentialRevision) {
  if (data.confirmedRevision === undefined) return undefined;
  if (
    !REVISION_AUTHORITIES.has(source) ||
    !Number.isSafeInteger(data.confirmedRevision) ||
    data.confirmedRevision < 1 ||
    data.confirmedRevision !== credentialRevision
  )
    throw new ApplicationError(403, 'AGENT_CONFIGURATION_UNAVAILABLE');
  return data.confirmedRevision;
}

module.exports = { agentRevisionAttestation };
