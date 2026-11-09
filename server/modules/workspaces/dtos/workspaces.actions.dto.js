/** @file DTO de entrada y salida de las acciones de workspaces; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
const workspacesActionDtos = createActionDtos([
  'workspaces-create',
  'workspaces-get-list',
  'workspaces-get-one',
  'workspaces-update',
  'workspaces-delete',
]);
module.exports = workspacesActionDtos;
