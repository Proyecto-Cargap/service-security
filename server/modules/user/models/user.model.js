/**
 * @file Esquema Mongoose de usuarios: campos, valores predeterminados y reglas de persistencia.
 * Define la estructura utilizada al crear y consultar documentos de este recurso.
 */
const { userPresenter } = require('../presenters/user.presenter');
const mongoose          = require('mongoose');
const Schema            = mongoose.Schema;
const schema            = new Schema({
  /** Revisión monotónica del productor para referencias durables de acceso. */
  revision                        : {
    type    : Number,
    default : 0,
    min     : 0,
  },
  /** Conversación externa inmutable; no admite acceso interactivo. */
  externalConversationCode        : {
    type      : String,
    default   : undefined,
    immutable : true,
  },
  /**
   * Espacio de acceso del registro; allWorkspaces permite compartirlo entre espacios.
   */
  workspace                       : {
    type     : String,
    default  : undefined,
    required : true,
  },

  /**
   * Código del usuario autor del registro; permanece inmutable después de su creación.
   */
  userCreate                      : {
    type      : String,
    default   : undefined,
    required  : false,
    immutable : true,
  },

  /**
   * Código del usuario asignado; una cadena vacía indica que no tiene asignación.
   */
  userAssigned                    : {
    type     : String,
    default  : undefined,
    required : false,
  },

  /**
   * Códigos de los espacios de trabajo a los que pertenece el usuario.
   */
  workspaces                      : {
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
   * Código de negocio que identifica al usuario asociado.
   */
  userCode                        : {
    type     : String,
    default  : undefined,
    required : [true, 'User code is required'],
    unique   : true,
  },

  /**
   * Dirección de correo utilizada como identificador de acceso del usuario.
   */
  user                            : {
    type     : String,
    default  : undefined,
    required : [true, 'email is required'],
    trim     : true,
    unique   : true,
  },

  /**
   * Código del contacto vinculado al usuario.
   */
  contactCode                     : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Código consecutivo de negocio del usuario.
   */
  code                            : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Códigos de los grupos que conceden permisos al usuario.
   */
  groups                          : {
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
   * Hash de la contraseña utilizado para autenticar al usuario.
   */
  password                        : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Código del rol de negocio asociado al usuario o la sesión.
   */
  roleCode                        : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Tipo de usuario utilizado para clasificar su origen.
   */
  userType                        : {
    type     : String,
    default  : 'internal',
    required : false,
  },
  /**
   * Identificador inmutable del agente asociado; ausente en identidades humanas.
   */
  agentCode                       : {
    type      : String,
    default   : undefined,
    immutable : true,
  },
  /**
   * Revisión monotónica de configuración del agente, ajena a las cuentas humanas.
   */
  agentRevision                   : {
    type    : Number,
    default : undefined,
  },
  /**
   * Huella del aprovisionamiento para reintentos idempotentes de una misma revisión.
   */
  agentConfigurationDigest        : {
    type    : String,
    default : undefined,
  },
  /**
   * Estado del aprovisionamiento coordinado con Intelligence.
   */
  agentIdentityState              : {
    type    : String,
    enum    : ['pending', 'ready', 'revoked'],
    default : undefined,
  },

  /**
   * Estado del ciclo de vida de la cuenta y valores admitidos.
   */
  state                           : {
    type     : String,
    default  : 'registered',
    required : false,
    enum     : ['registered', 'authorized', 'active', 'inactive', 'blocked'],
  },

  /**
   * Cantidad de intentos de acceso registrada para la cuenta.
   */
  numberAttemptsAccess            : {
    type     : Number,
    default  : 0,
    required : false,
  },

  /**
   * Instante del último acceso del usuario, expresado en milisegundos.
   */
  lastAccessDate                  : {
    type     : Number,
    default  : null,
    required : false,
  },

  /**
   * Token utilizado exclusivamente por el flujo de confirmación de la cuenta.
   */
  activationToken                 : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Origen interno del bloqueo automático; vacío para decisiones administrativas.
   */
  accessBlockReason               : {
    type    : String,
    default : '',
  },

  /**
   * Revisión temporal de credenciales que invalida autorizaciones anteriores.
   */
  credentialsChangedAt            : {
    type    : Number,
    default : 0,
  },

  /**
   * Huella SHA-256 del último enlace de recuperación.
   */
  passwordRecoveryHash            : {
    type    : String,
    default : '',
  },

  /**
   * Caducidad del enlace de recuperación en milisegundos.
   */
  passwordRecoveryExpiresAt       : {
    type    : Number,
    default : 0,
  },

  /**
   * Instante del último envío de recuperación aceptado.
   */
  passwordRecoveryLastRequestedAt : {
    type    : Number,
    default : 0,
  },

  /**
   * Inicio de la ventana horaria de envíos.
   */
  passwordRecoveryWindowStart     : {
    type    : Number,
    default : 0,
  },

  /**
   * Cantidad de envíos aceptados en la ventana horaria.
   */
  passwordRecoveryRequests        : {
    type    : Number,
    default : 0,
  },

  /**
   * Instante límite de vigencia del usuario, expresado en milisegundos.
   */
  validity                        : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de user.model.
     * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    default  : function () {
      return new Date().getTime();
    },
    required : false,
  },

  /**
   * Instante de la última modificación del registro, expresado en milisegundos.
   */
  updateDate                      : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de user.model.
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
  creationDate                    : {
    type     : Number,
    /**
     * Ejecuta default dentro del flujo de user.model.
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
  idTransaction                   : {
    type     : String,
    default  : '',
    required : false,
  },

  /**
   * Indica si el registro está marcado como borrado lógico.
   */
  erased                          : {
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
schema.index({
  userCode : 1,
  userType : -1,
});
schema.index({
  code     : 1,
  userType : -1,
});
schema.index({
  user     : 1,
  userType : -1,
});
schema.index({
  groups   : 1,
  userType : -1,
});
schema.index({
  activationToken : 1,
  userType        : -1,
});
schema.index({
  state    : 1,
  userType : -1,
});

schema.add({
  deletionDate    : {
    type   : Number,
    select : false,
  },
  sessionRevision : {
    type    : Number,
    default : 0,
    select  : false,
  },
});

/**
 * Proyecta los campos públicos que se pueden serializar.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
schema.methods.toJSON = function () {
  return userPresenter(this);
};
module.exports = mongoose.model('SECURITY_USER', schema, 'SECURITY_USER');
