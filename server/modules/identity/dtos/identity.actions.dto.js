/** @file DTO de entrada y salida de las acciones de identity; reutilizan los esquemas vigentes del servicio. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
const identityActionDtos   = createActionDtos([
  'identity-get-current',
  'session-own-access-get',
  'user-principals-get-list',
  'user-delivery-addresses-get-list',
  'user-active-profiles-get-list',
  'user-personal-principals-get-list',
  'user-references-get-list',
  'user-profile-get-list',
  'user-profile-get-one',
  'user-picture-read',
  'user-directory-get-list',
  'workspace-users-get-list',
  'workspace-principals-get-list',
]);
module.exports = identityActionDtos;
