/** @file Resolución autoritativa del principal de un agente con permisos vigentes y referencias paginadas completas. */
'use strict';
/** Compone la lectura de autorización sin SDK ni conexiones propias.
 * @param {Object} dependencies Capacidades mínimas para leer identidad, espacios, grupos y políticas.
 * @returns {Function} Resuelve el principal o rechaza ante ausencia, revocación o revisión obsoleta.
 */
function agentCurrentService({
  ApplicationError,
  code,
  groupScopes,
  groups,
  messaging,
  policies,
  policyScopes,
  readAll,
  userScopes,
  users,
  workspaceScopes,
  workspaces,
}) {
  /**
   * Ejecuta current dentro del flujo de agent-principal.service.
   * @param {*} agentCode Valor de agentCode utilizado por esta operación.
   * @param {string} workspace Espacio de trabajo que delimita la operación.
   * @param {*} runCode Valor de runCode utilizado por esta operación.
   * @param {*} [initiatedByUserCode] Valor de initiatedByUserCode utilizado por esta operación.
   * @param {*} confirmedRevision Valor de confirmedRevision utilizado por esta operación.
   * @param {Function} [read] Lecturas efímeras del lote interno; no se acepta desde el transporte.
   * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function current(
    agentCode,
    workspace,
    runCode,
    initiatedByUserCode = '',
    confirmedRevision,
    read,
  ) {
    if (
      !code(agentCode) ||
      !code(workspace) ||
      workspace === 'allWorkspaces' ||
      !code(runCode) ||
      (initiatedByUserCode && !code(initiatedByUserCode))
    )
      throw new ApplicationError(400, 'INVALID_AGENT_PRINCIPAL');
    /** Lee autoridad vigente sin vincularla todavía a una ejecución concreta.
     * @returns {Promise<Object>} Permisos del agente en este workspace y revisión.
     */
    async function authority() {
      const user = await users.getOne(
        {
          agentCode,
          userType           : 'agent',
          erased             : false,
          state              : 'active',
          agentIdentityState : 'ready',
          validity           : { $gt: Date.now() },
        },
        userScopes.guest,
      );
      if (!user || !user.workspaces?.includes(workspace))
        throw new ApplicationError(403, 'AGENT_PRINCIPAL_UNAVAILABLE');
      if (confirmedRevision !== undefined) {
        if (!Number.isSafeInteger(confirmedRevision) || confirmedRevision !== user.agentRevision)
          throw new ApplicationError(403, 'AGENT_CONFIGURATION_UNAVAILABLE');
      } else {
        const accepted = await messaging.request('service-intelligence', 'agent-principal-state', {
          agentCode,
          revision : user.agentRevision,
          workspace,
        });
        if (accepted?.statusCode !== 200 || accepted.data?.active !== true)
          throw new ApplicationError(403, 'AGENT_CONFIGURATION_UNAVAILABLE');
      }
      if (
        !(await workspaces.getOne(
          {
            workspaceCode : workspace,
            erased        : false,
          },
          workspaceScopes.guest,
        ))
      )
        throw new ApplicationError(403, 'WORKSPACE_FORBIDDEN');
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
              groupCode : { $in: user.groups },
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
      const policyCodes = [
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
      ];
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
              policyCode : { $in: policyCodes },
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
      return {
        userCode      : user.userCode,
        agentRevision : user.agentRevision,
        contactCode   : user.contactCode,
        agentCode,
        actorType     : 'agent',
        workspace,
        workspaces    : [...user.workspaces],
        groups        : selected.listItem.map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {*} group Valor de group utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (group) => group.groupCode,
        ),
        policies      : [
          ...new Set(
            effective.listItem.map(
              /**
               * Proyecta cada elemento en la estructura requerida por la operación.
               * @param {*} policy Valor de policy utilizado por esta operación.
               * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
               */
              (policy) => policy.identifier,
            ),
          ),
        ],
      };
    }
    const principal = read
      ? await read('agent-authority', [agentCode, workspace, confirmedRevision], authority)
      : await authority();
    return {
      ...principal,
      runCode,
      initiatedByUserCode,
    };
  }
  return current;
}
module.exports = { agentCurrentService };
