/**
 * @file Esquema Mongoose de espacios de trabajo: campos, valores predeterminados y reglas de
 * persistencia.
 * Define la estructura utilizada al crear y consultar documentos de este recurso.
 */
const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const schema   = new Schema({
  /** Revisión monotónica del productor para referencias durables de acceso. */
  revision       : {
    type    : Number,
    default : 0,
    min     : 0,
  },
  /**
   * Espacio de acceso del registro; allWorkspaces permite compartirlo entre espacios.
   */
  workspace      : {
    type     : String,
    default  : undefined,
    required : true,
  },

  /**
   * Código del usuario autor del registro; permanece inmutable después de su creación.
   */
  userCreate     : {
    type      : String,
    default   : undefined,
    required  : false,
    immutable : true,
  },

  /**
   * Código del usuario asignado; una cadena vacía indica que no tiene asignación.
   */
  userAssigned   : {
    type     : String,
    default  : undefined,
    required : false,
  },

  /**
   * Código de negocio que identifica el espacio de trabajo.
   */
  workspaceCode  : {
    type     : String,
    default  : undefined,
    required : true,
    unique   : true,
  },

  /**
   * Nombre utilizado para identificar visualmente el registro.
   */
  name           : {
    type     : String,
    default  : undefined,
    required : [true, 'name not found'],
    trim     : true,
  },

  /**
   * Descripción del registro utilizada en su presentación.
   */
  description    : {
    type     : String,
    default  : '',
    required : false,
    trim     : true,
  },

  /**
   * Referencia de la imagen utilizada para representar el espacio de trabajo.
   */
  picture        : {
    type     : String,
    default  : '',
    required : false,
    trim     : true,
  },

  /**
   * Referencia pública y tamaños generados por Files.
   */
  pictureFile    : {
    type     : Schema.Types.Mixed,
    default  : null,
    required : false,
  },

  /**
   * Variantes reemplazadas cuya limpieza se reintenta desde el dominio.
   */
  pictureCleanup : {
    type     : [String],
    default  : [],
    required : false,
  },

  /**
   * Instante de la última modificación del registro, expresado en milisegundos.
   */
  updateDate     : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de workspaces.model.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    default  : function () {
      return new Date().getTime();
    },
    required : false,
  },

  /**
   * Instante de creación del registro, expresado en milisegundos.
   */
  creationDate   : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de workspaces.model.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    default  : function () {
      return new Date().getTime();
    },
    required : false,
  },

  /**
   * Identificador de correlación de la operación que produjo el registro.
   */
  idTransaction  : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Indica si el registro está marcado como borrado lógico.
   */
  erased         : {
    type     : Boolean,
    default  : false,
    required : false,
  },
});
schema.pre(
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
schema.index({
  workspace  : 1,
  userCreate : 1,
});
schema.index({
  workspace    : 1,
  userAssigned : 1,
});

schema.set('versionKey', false);
schema.set('autoIndex', false);
module.exports = mongoose.model('SECURITY_WORKSPACES', schema, 'SECURITY_WORKSPACES');
