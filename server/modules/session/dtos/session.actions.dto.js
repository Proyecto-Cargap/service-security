/** @file DTO de entrada y salida de las acciones de session; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
const sessionActionDtos    = createActionDtos([
  'session-own-profile-get',
  'session-own-profile-picture-read',
  'session-profile-picture-read',
  'session-get-one',

  'session-authenticate',
  'session-create',
  'session-get-list',
  'session-delete',
  'session-renovate',
  'session-restore',
  'session-update',
  'session-delete-by-token',
]);
module.exports = sessionActionDtos;
