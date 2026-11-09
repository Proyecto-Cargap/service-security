/** @file DTO de entrada y salida de las acciones de agent-principal; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos }     = require('../../../contracts/action-dto');
const agentPrincipalActionDtos = createActionDtos([
  'agent-principal-activate',
  'agent-principal-provision',
  'agent-principal-resolve',
  'agent-principal-authenticate',
  'agent-principal-audience',
  'agent-principal-audience-batch',
  'agent-principal-revoke',
]);
module.exports = agentPrincipalActionDtos;
