/** @file DTO de entrada y salida de las acciones de policy; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
const policyActionDtos     = createActionDtos([
  'policy-create',
  'policy-update',
  'policy-delete',
  'policy-get-list',
  'policy-get-one',
  'policy-get-index',
]);
module.exports = policyActionDtos;
