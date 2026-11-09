/**
 * @file Esquema Mongoose de parámetros de configuración: campos, valores predeterminados y reglas de
 * persistencia.
 * Define la estructura utilizada al crear y consultar documentos de este recurso.
 */
const mongoose       = require('mongoose');
const Schema         = mongoose.Schema;
const settingsSchema = new Schema(
  {
    revision     : {
      type    : Number,
      default : 0,
    },
    /**
     * Espacio de acceso del registro; allWorkspaces permite compartirlo entre espacios.
     */
    workspace    : {
      type     : String,
      default  : undefined,
      required : true,
    },

    /**
     * Código del usuario autor del registro; permanece inmutable después de su creación.
     */
    userCreate   : {
      type      : String,
      default   : undefined,
      required  : false,
      immutable : true,
    },

    /**
     * Código del usuario asignado; una cadena vacía indica que no tiene asignación.
     */
    userAssigned : {
      type     : String,
      default  : undefined,
      required : false,
    },

    /**
     * Clave que identifica el parámetro de configuración.
     */
    parameter    : {
      type     : String,
      default  : undefined,
      required : [true, 'Parameter Name not found'],
    },

    /**
     * Contenido de configuración conservado sin imponer una estructura interna.
     */
    data         : {
      type     : Schema.Types.Mixed,
      default  : undefined,
      required : false,
    },
  },
  {
    versionKey : false,
    strict     : false,
  },
);
settingsSchema.pre(
  'validate',

  /**
   * Comprueba las condiciones de validateAccessMetadata antes de continuar.
   * @returns {void} Finaliza después de aplicar los efectos de la operación.
   */
  function validateAccessMetadata() {
    for (const field of ['workspace', 'userCreate', 'userAssigned']) {
      if (typeof this[field] !== 'string') this.invalidate(field, 'ACCESS_METADATA_REQUIRED');
    }
  },
);
settingsSchema.index({
  workspace  : 1,
  userCreate : 1,
});
settingsSchema.index({
  workspace    : 1,
  userAssigned : 1,
});

settingsSchema.set('autoIndex', false);
settingsSchema.index({
  parameter : 1,
});
module.exports = mongoose.model('SECURITY_SETTINGS', settingsSchema, 'SECURITY_SETTINGS');
