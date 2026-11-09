/** @file Proyección pura de la ficha administrativa; recibe referencias resueltas sin consultar servicios ni persistencia. */
'use strict';
const { sessionDTO } = require('../dtos/session.dto');

/**
 * Selecciona la representación administrativa de una sesión ya autorizada.
 * @param {Object} input Sesión y referencias acreditadas por el caso de uso de consulta.
 * @returns {Object} Ficha pública sin tokens, permisos ni referencias privadas del usuario.
 */
function sessionDetailPresenter({ record, account, workspaceName, roleName, profile }) {
  return {
    ...sessionDTO(record),
    user : typeof account?.user === 'string' && account.user.trim() ? account.user.trim() : null,
    roleName,
    workspaceName,
    profile,
  };
}

module.exports = { sessionDetailPresenter };
