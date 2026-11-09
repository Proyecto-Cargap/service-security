/** @file Casos de uso de agentes de la capacidad de destinatarios; conserva errores, autorizaciones y efectos vigentes. */
'use strict';
const { externalPolicies } = require('../../external-principal/policies/external-access.policy');
/** Compone una capacidad de agentes con colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por estas operaciones.
 * @returns {Object} Operaciones de aplicación sin construir SDK ni repositorios.
 */
function agentAudienceService({
  ApplicationError,
  codes,
  current,
  groupScopes,
  groups,
  origin,
  policies,
  policyScopes,
  readAll,
  userScopes,
  users,
}) {
  /** Consulta los permisos de un destinatario sin unirlos con los del publicador.
   * @param {string} userCode Identidad solicitada.
   * @param {string} workspace Espacio concreto.
   * @returns {Promise<Object>} Principal individual vigente.
   */
  async function readPrincipal(userCode, workspace) {
    const user = await users.getOne(
      {
        userCode,
        erased   : false,
        state    : 'active',
        validity : { $gt: Date.now() },
      },
      userScopes.guest,
    );
    if (!user || !user.workspaces?.includes(workspace))
      throw new ApplicationError(403, 'AGENT_AUDIENCE_FORBIDDEN');
    const selected    = await readAll(
      /**
       * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
       * @param {number} page Índice de la página según el contrato de esta operación.
       * @param {number} perPage Cantidad máxima de elementos por página.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (page, perPage) =>
        groups.getList(
          {
            groupCode : { $in: user.groups || [] },
            erased    : false,
            workspace : { $in: [workspace, 'allWorkspaces'] },
          },
          {
            ...{},
            _id : 1,
          },
          page,
          perPage,
          'groupCode policies',
          groupScopes.guest,
        ),
    );
    const effective   = await readAll(
      /**
       * Ejecuta la continuación local y propaga el resultado al flujo que la invoca.
       * @param {number} page Índice de la página según el contrato de esta operación.
       * @param {number} perPage Cantidad máxima de elementos por página.
       * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
       */
      (page, perPage) =>
        policies.getList(
          {
            policyCode : {
              $in : [
                ...new Set(
                  selected.listItem.flatMap(
                    /**
                     * Proyecta y reúne los elementos en una sola colección.
                     * @param {*} group Valor de group utilizado por esta operación.
                     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
                     */
                    (group) => group.policies || [],
                  ),
                ),
              ],
            },
            erased     : false,
            active     : true,
            workspace  : { $in: [workspace, 'allWorkspaces'] },
          },
          {
            ...{},
            _id : 1,
          },
          page,
          perPage,
          'identifier',
          policyScopes.guest,
        ),
    );
    const identifiers = effective.listItem.map(
      /** @param {Object} item Política vigente. @returns {string} Identificador exacto. */
      (item) => item.identifier,
    );
    return {
      userCode,
      actorType : user.userType === 'agent' ? 'agent' : 'human',
      workspace : workspace,
      policies  :
        user.userType === 'external' ? externalPolicies(identifiers) : [...new Set(identifiers)],
    };
  }
  /**
   * Resuelve permisos individuales frescos para comprobar la audiencia de contenido compartido.
   * @param {Object} data Agente, espacio, run y destinatarios explícitos.
   * @param {string} source Servicio de Intelligence.
   * @returns {Promise<Object>} Publicador y destinatarios independientes, sin credenciales ni unión de permisos.
   */
  async function audience(data, source, read) {
    origin(source);
    if (!Number.isSafeInteger(data?.confirmedRevision) || data.confirmedRevision < 1)
      throw new ApplicationError(403, 'AGENT_CONFIGURATION_UNAVAILABLE');
    const publisher = await current(
      data?.agentCode,
      data?.workspace,
      data?.runCode,
      data?.initiatedByUserCode,
      data.confirmedRevision,
      read,
    );
    if (!codes(data.userCodes) || !data.userCodes.length)
      throw new ApplicationError(400, 'INVALID_AGENT_AUDIENCE');
    const principals = [];
    for (const userCode of data.userCodes) {
      /** @returns {Promise<Object>} Lectura propia del sujeto actual. */
      const operation = () => readPrincipal(userCode, data.workspace);
      principals.push(
        read ? await read('recipient', [userCode, data.workspace], operation) : await operation(),
      );
    }
    return {
      publisher,
      principals,
    };
  }
  return {
    audience,
    /** Acredita hasta cien audiencias con lecturas compartidas sólo dentro de esta petición.
     * @param {Object} data Audiencias cerradas por el DTO, en orden.
     * @param {string} source Origen interno autorizado.
     * @returns {Promise<Object>} Autorización individual; los fallos técnicos se propagan.
     */
    async audienceBatch(data, source) {
      origin(source);
      if (
        !Array.isArray(data?.audiences) ||
        data.audiences.length < 1 ||
        data.audiences.length > 100
      )
        throw new ApplicationError(400, 'INVALID_AGENT_AUDIENCE');
      const readings = new Map();
      /** Reutiliza autoridad y destinatarios exactos sin almacenar credenciales ni permisos entre peticiones.
       * @param {string} kind Clase de autorización.
       * @param {Array} key Identidad, ámbito y revisión de la lectura.
       * @param {Function} operation Consulta autoritativa sin efectos.
       * @returns {Promise<Object>} Datos de esta petición; nunca memoriza fallos técnicos.
       */
      async function read(kind, key, operation) {
        const id = JSON.stringify([kind, key]);
        if (!readings.has(id)) {
          if (readings.size >= 512) throw new ApplicationError(503, 'AGENT_AUDIENCE_LIMIT');
          readings.set(id, Promise.resolve().then(operation));
        }
        try {
          return await readings.get(id);
        } catch (error) {
          if (![400, 401, 403, 404, 409, 410].includes(error.statusCode)) readings.delete(id);
          throw error;
        }
      }
      const items = [];
      for (let offset = 0; offset < data.audiences.length; offset += 4) {
        items.push(
          ...(await Promise.all(
            data.audiences.slice(offset, offset + 4).map(
              /** @param {Object} input Ejecución y destinatarios independientes. @returns {Promise<Object>} Resultado en la misma posición de entrada. */
              async (input) => {
                try {
                  return {
                    allowed : true,
                    ...(await audience(input, source, read)),
                  };
                } catch (error) {
                  if (![400, 401, 403, 404, 409, 410].includes(error.statusCode)) throw error;
                  return { allowed: false };
                }
              },
            ),
          )),
        );
      }
      return { items };
    },
  };
}
module.exports = { agentAudienceService };
