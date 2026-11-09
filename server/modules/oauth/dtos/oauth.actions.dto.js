/** @file DTO cerrados de almacenamiento privado OAuth y autorización delegada. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
module.exports = createActionDtos([
  'oauth-realtime-ticket-create',
  'oauth-realtime-ticket-consume',
  'oauth-execution-record',
  'oauth-client-authorize',
  'oauth-storage-get',
  'oauth-storage-put',
  'oauth-storage-consume',
  'oauth-storage-destroy',
  'oauth-family-revoke',
  'oauth-account-get',
  'oauth-grant-create',
  'oauth-grant-get-list',
  'oauth-grant-revoke',
  'oauth-principal-resolve',
]);
