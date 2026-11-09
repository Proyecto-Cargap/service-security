/**
 * @file Esquema Mongoose de sesiones: campos, valores predeterminados y reglas de persistencia.
 * Define la estructura utilizada al crear y consultar documentos de este recurso.
 */
const mongoose      = require('mongoose');
const Schema        = mongoose.Schema;
const sessionSchema = new Schema({
  /** Revisión monotónica del productor para referencias durables de acceso. */
  revision                 : {
    type    : Number,
    default : 0,
    min     : 0,
  },
  /** Vínculo interno obligatorio para sujetos externos. */
  externalConversationCode : {
    type    : String,
    default : undefined,
  },
  /** TTL sólo de sesiones externas, sin modificar la retención de sesiones humanas. */
  externalExpiresAt        : {
    type    : Date,
    default : undefined,
  },
  /**
   * Espacio de acceso del registro; allWorkspaces permite compartirlo entre espacios.
   */
  workspace                : {
    type     : String,
    default  : undefined,
    required : true,
  },

  /**
   * Código del usuario autor del registro; permanece inmutable después de su creación.
   */
  userCreate               : {
    type      : String,
    default   : undefined,
    required  : false,
    immutable : true,
  },

  /**
   * Código del usuario asignado; una cadena vacía indica que no tiene asignación.
   */
  userAssigned             : {
    type     : String,
    default  : undefined,
    required : false,
  },

  /**
   * Código del espacio de trabajo seleccionado para la sesión.
   */
  activeWorkspace          : {
    type     : String,
    default  : undefined,
    required : true,
  },

  /**
   * Código de negocio que identifica la sesión.
   */
  sessionCode              : {
    type     : String,
    default  : undefined,
    required : [true, 'Session code not found'],
  },

  /**
   * Token firmado asociado a la autenticación de la sesión.
   */
  token                    : {
    type     : String,
    default  : undefined,
    required : [true, 'Token not found'],
    unique   : true,
  },

  /**
   * Código del rol de negocio asociado al usuario o la sesión.
   */
  roleCode                 : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Código de negocio que identifica al usuario asociado.
   */
  userCode                 : {
    type     : String,
    default  : undefined,
    required : [true, 'User code not found'],
  },

  /**
   * Identificadores de los módulos asociados a la sesión.
   */
  modules                  : {
    type     : [
      {
        type     : String,
        default  : '',
        required : false,
      },
    ],
    default  : [],
    required : false,
  },

  /**
   * Identificadores de las políticas de acceso asociadas al registro.
   */
  policies                 : {
    type     : [
      {
        type     : String,
        default  : '',
        required : false,
      },
    ],
    default  : [],
    required : false,
  },

  /**
   * Códigos de los espacios de trabajo a los que pertenece el usuario.
   */
  workspaces               : {
    type     : [
      {
        type     : String,
        default  : '',
        required : false,
      },
    ],
    default  : [],
    required : false,
  },

  /**
   * Indica si el registro se encuentra activo.
   */
  active                   : {
    type     : Boolean,
    default  : true,
    required : false,
  },

  /**
   * Instante de inicio de la sesión, expresado en milisegundos.
   */
  start                    : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de session.model.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    default  : function () {
      return new Date().getTime();
    },
    required : false,
  },

  /**
   * Instante del último acceso de la sesión, expresado en milisegundos.
   */
  lastAccess               : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de session.model.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    default  : function () {
      return new Date().getTime();
    },
    required : false,
  },

  /**
   * Instante de expiración de la sesión, expresado en segundos desde la época Unix.
   */
  expiration               : {
    type     : Number,
    default  : undefined,
    required : [true, 'Expiration session date no found'],
  },

  /** Vencimiento cuya transición ya fue publicada; nunca cambia el cierre explícito de la sesión. */
  expirationNoticeFor      : {
    type    : Number,
    default : undefined,
  },

  /**
   * Instante de cierre de la sesión, expresado en milisegundos.
   */
  end                      : {
    type     : Number,
    default  : 0,
    required : false,
  },

  /**
   * Identificador de correlación de la operación que produjo el registro.
   */
  idTransaction            : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Indica si el registro está marcado como borrado lógico.
   */
  erased                   : {
    type     : Boolean,
    default  : false,
    required : false,
  },

  /**
   * Instante de la última modificación del registro, expresado en milisegundos.
   */
  updateDate               : {
    type     : Number,
    default  : Date.now,
    required : false,
  },
});
sessionSchema.pre(
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
sessionSchema.index({
  workspace  : 1,
  userCreate : 1,
});
sessionSchema.index({
  workspace    : 1,
  userAssigned : 1,
});

sessionSchema.index({ externalExpiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.set('versionKey', false);
sessionSchema.set('autoIndex', false);
sessionSchema.index({
  userCode : 1,
});
sessionSchema.index({
  active : 1,
});
module.exports = mongoose.model('SECURITY_SESSION', sessionSchema, 'SECURITY_SESSION');
