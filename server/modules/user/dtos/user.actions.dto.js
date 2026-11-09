/** @file DTO de entrada y salida de las acciones de user; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
const userActionDtos       = createActionDtos([
  'user-deletion-email',
  'user-reference-exists',
  'user-register',
  'user-update-password',

  'user-create',
  'user-update',
  'user-get-list',
  'user-get-one',
  'user-get-one-byemail',
  'user-put-confirmation',
  'user-get-policy',
  'user-recover-password',
  'user-delete',
  'user-confirm-user',
  'directory.contact.update.roleCode',
]);
module.exports = userActionDtos;
