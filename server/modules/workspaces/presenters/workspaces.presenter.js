/** @file Representación pública de workspaces e imágenes; la cola interna de limpieza permanece dentro de Security. */
'use strict';
const { publicRecord } = require('../../../shared/public-record');
const WORKSPACE_FIELDS = Object.freeze([
  '_id',
  'revision',
  'workspaceCode',
  'workspace',
  'userCreate',
  'userAssigned',
  'name',
  'description',
  'picture',
  'updateDate',
  'creationDate',
  'idTransaction',
  'erased',
]);
const {
  PICTURE_REFERENCE_FIELDS : PICTURE_FIELDS,
} = require('../../security/ports/security-pictures.port');

/**
 * Selecciona datos públicos y los campos de imagen consumidos por la web y otros servicios.
 * @param {Object|null} record Registro autorizado del workspace, completo o parcial.
 * @returns {Object|null} Workspace sin referencias de limpieza ni metadatos privados de almacenamiento.
 */
function workspacesPresenter(record) {
  const result = publicRecord(record, WORKSPACE_FIELDS);
  if (result && record.pictureFile !== undefined)
    result.pictureFile = publicRecord(record.pictureFile, PICTURE_FIELDS);
  return result;
}

module.exports = {
  WORKSPACE_FIELDS,
  PICTURE_FIELDS,
  workspacesPresenter,
};
