/** @file Representación pública de identidades administrativas de agentes, sin configuración ni consultas. */
'use strict';

/**
 * Selecciona la identidad pública y copia sus membresías sin exponer huellas, contraseñas o estados técnicos.
 * @param {Object} user Registro autorizado de agente con revisión, identificadores y membresías completas.
 * @returns {Object} Identidad administrativa con revisión, estado y colecciones independientes; no modifica el registro.
 */
function agentPrincipalPresenter(user) {
  return {
    revision    : user.agentRevision,
    agentCode   : user.agentCode,
    userCode    : user.userCode,
    contactCode : user.contactCode,
    actorType   : 'agent',
    state       : user.state,
    groups      : [...user.groups],
    workspaces  : [...user.workspaces],
    workspace   : user.workspace,
  };
}
module.exports = { agentPrincipalPresenter };
