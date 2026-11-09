/** @file Limpieza durable de imágenes desvinculadas; sus identificadores nunca salen a los clientes. */
'use strict';
const mongoose = require('mongoose');
const schema   = new mongoose.Schema(
  {
    _id           : String,
    workspaceCode : {
      type     : String,
      required : true,
    },
    fileId        : {
      type     : String,
      required : true,
    },
    nextAt        : {
      type     : Number,
      required : true,
    },
    token         : String,
    attempts      : {
      type    : Number,
      default : 0,
    },
  },
  {
    versionKey : false,
    autoIndex  : false,
    autoCreate : false,
  },
);
schema.index({
  nextAt : 1,
  _id    : 1,
});
module.exports =
  mongoose.models.SECURITY_PICTURE_CLEANUP ||
  mongoose.model('SECURITY_PICTURE_CLEANUP', schema, 'SECURITY_PICTURE_CLEANUP');
