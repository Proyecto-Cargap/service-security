/** @file Casos de uso de agentes de la capacidad de credenciales; conserva errores, autorizaciones y efectos vigentes. */
'use strict';
/** Compone una capacidad de agentes con colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por estas operaciones.
 * @returns {Object} Operaciones de aplicación sin construir SDK ni repositorios.
 */
function agentCredentialsService({
  ApplicationError,
  agentRevisionAttestation,
  current,
  jwt,
  origin,
  secret,
  tokenContexts,
}) {
  return {
    /**
     * Emite una credencial breve ligada al run y al espacio vigente del agente.
     * @param {Object} data Agente, run, espacio e iniciador de la ejecución.
     * @param {string} source Servicio de ejecución autorizado.
     * @returns {Promise<Object>} Principal fresco, credencial interna y caducidad.
     */
    async resolve(data, source) {
      origin(source);
      if (!Number.isSafeInteger(data?.confirmedRevision) || data.confirmedRevision < 1)
        throw new ApplicationError(403, 'AGENT_CONFIGURATION_UNAVAILABLE');
      const principal = await current(
        data?.agentCode,
        data?.workspace,
        data?.runCode,
        data?.initiatedByUserCode,
        data.confirmedRevision,
      );
      const token     = jwt.sign(
        {
          purpose             : 'agent_execution',
          agentCode           : principal.agentCode,
          userCode            : principal.userCode,
          agentRevision       : principal.agentRevision,
          workspace           : principal.workspace,
          runCode             : principal.runCode,
          initiatedByUserCode : principal.initiatedByUserCode,
        },
        secret(),
        {
          algorithm : 'HS256',
          ...tokenContexts.agent_execution,
          expiresIn : 120,
        },
      );
      return {
        principal,
        token,
        expiration : jwt.decode(token).exp,
      };
    },
    /**
     * Autentica la credencial y vuelve a leer todos los permisos y estados actuales.
     * @param {Object} data Credencial firmada de ejecución, nunca una sesión de navegador.
     * @param {string} source Adaptador interno que requiere la identidad vigente.
     * @returns {Promise<Object>} Principal autorizado actual y caducidad de la credencial.
     */
    async authenticate(data, source) {
      origin(source, [
        'service-apigateway',
        'service-communication',
        'service-documents',
        'service-intelligence',
      ]);
      if (typeof data?.token !== 'string' || data.token.length > 8192)
        throw new ApplicationError(401, 'INVALID_AGENT_CREDENTIAL');
      let claims;
      try {
        claims = jwt.verify(data.token, secret(), {
          algorithms : ['HS256'],
          ...tokenContexts.agent_execution,
        });
      } catch {
        throw new ApplicationError(401, 'INVALID_AGENT_CREDENTIAL');
      }
      if (claims.purpose !== 'agent_execution')
        throw new ApplicationError(401, 'INVALID_AGENT_CREDENTIAL');
      const confirmedRevision = agentRevisionAttestation(data, source, claims.agentRevision);
      const principal         = await current(
        claims.agentCode,
        claims.workspace,
        claims.runCode,
        claims.initiatedByUserCode,
        confirmedRevision,
      );
      if (
        principal.userCode !== claims.userCode ||
        principal.agentRevision !== claims.agentRevision
      )
        throw new ApplicationError(401, 'INVALID_AGENT_CREDENTIAL');
      return {
        principal,
        expiration : claims.exp,
      };
    },
  };
}
module.exports = { agentCredentialsService };
