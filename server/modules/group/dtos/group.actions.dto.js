/** @file DTO de entrada y salida de las acciones de group; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
const groupActionDtos      = createActionDtos([
  'group-create',
  'group-get-list',
  'group-get-one',
  'group-update',
  'group-delete',
  'group-add-policy',
  'group-remove-policy',
]);
module.exports = groupActionDtos;
