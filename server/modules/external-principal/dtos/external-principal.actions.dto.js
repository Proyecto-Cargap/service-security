/** @file DTO explícitos de aprovisionamiento y resolución interna de personas externas. */
'use strict';
const { createActionDtos } = require('../../../contracts/action-dto');
module.exports = createActionDtos(['external-principal-provision', 'external-principal-resolve']);
