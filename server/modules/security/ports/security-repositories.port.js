/** @file Contratos internos de persistencia de Security; definen datos, errores, ausencia, orden, paginación y garantías transaccionales por capacidad. */
'use strict';

/**
 * @typedef {Object} IdentifierAllocator
 * @property {function(string, string=):Promise<string>} getObjectCode Con modo code asigna una secuencia atómica independiente por prefijo, desde cero y con siete dígitos mínimos; las creaciones concurrentes no repiten valores. Otro modo devuelve prefijo y UUID sin consumir la secuencia. Propaga fallos de persistencia; si la confirmación de una escritura es incierta, puede existir un valor reservado. No promete ausencia de huecos después de fallos.
 */

/**
 * @typedef {Object} SettingsReader
 * @property {function(string, (string|symbol)=):Promise<Object|null>} get Devuelve el parámetro autorizado como registro simple o null si no existe; el permiso ausente rechaza 403. No aplica configuración alternativa.
 * @property {function((string|symbol)=):Promise<Object[]>} getAll Devuelve la colección autorizada de parámetros editables conocidos, con límite de integridad cien; no promete orden y rechaza 409 si una colección corrupta excede el límite.
 */

/**
 * @typedef {Object} SettingsWriter
 * @property {function(string, Object, (string|symbol)=):Promise<Object|null>} update Actualiza sólo campos editables conocidos sin reemplazar el resto de data; devuelve el registro posterior o null si no existe. Denegación 403, entrada inválida 400; no publica avisos ni reintenta automáticamente.
 */

/**
 * @typedef {Object} RecordReader
 * @property {function(Object, (string|symbol)=):Promise<Object|null>} getOne Lee un registro simple o null ante ausencia/lectura denegada; no devuelve Query, documentos ni identificadores BSON. No modifica el filtro.
 * @property {function(Object, Object=, number=, number=, (string|Object)=, (string|symbol)=):Promise<{listItem:Object[],totalCount:number}>} getList Página interna desde cero con total autorizado y orden explícito estable. perPage entre 0 y 10000; cero conserva consultas internas sin límite. Rechaza 400 ante tipos o rangos inválidos; una lectura denegada devuelve página vacía.
 */

/**
 * @typedef {Object} ResourceWriter
 * @property {function(Object, (string|symbol)=):Promise<Object>} create Aplica metadatos autorizados y validación antes de guardar; devuelve registro simple. Denegación 403; conflictos de unicidad conservan code=11000 para la traducción pública vigente a 409.
 * @property {function(Object, Object, (string|symbol)=):Promise<Object|null>} update Escritura autorizada y validada con comparación de las condiciones recibidas. Devuelve el resultado posterior o null si cambió/no coincide; no reintenta automáticamente.
 * @property {function(Object, (string|symbol)=, string=):Promise<Object>} updateItem Autoriza por identificador y cambios, conserva userCreate inmutable y actualiza updateDate. Devuelve registro simple; ausencia/denegación 403. operation=delete exige el permiso de baja.
 * @property {function(Object, boolean=, (string|symbol)=):Promise<Object|null>} deleteOne Baja lógica validada o eliminación física según el modo explícito. Devuelve el registro afectado o null cuando no coincide; no revoca otras entidades implícitamente.
 */

/**
 * @typedef {Object} ReferenceReader
 * @property {function(string[], (string|Object)=, (string|symbol)=):Promise<Object[]>} getReferences Acredita el alcance y resuelve como máximo cien códigos únicos. No promete el orden de entrada; usa las claves del registro para correlacionar. Una lista vacía o denegada devuelve []. Entradas inválidas producen 400.
 */

/**
 * @typedef {Object} UserTransactions
 * @property {function(Object, (string|symbol), Object):Promise<Object>} markDeleted Aplica la baja y deletionDate con la sesión transaccional opaca recibida. No publica ni confirma la transacción; el resultado conserva metadatos privados sólo dentro de Security.
 * @property {function(string, number, Object):Promise<void>} lockForSession Cerca la emisión con una escritura sobre la cuenta vigente y su revisión de credenciales dentro de la misma sesión; una cuenta no vigente rechaza 401 INVALID_SESSION.
 */

/**
 * @typedef {Object} SessionTransactions
 * @property {function(Object, (string|symbol)=, Object=):Promise<Object>} create Crea la sesión validada dentro de la transacción recibida cuando existe; conserva el token únicamente en el registro interno.
 * @property {function(string, Object):Promise<Object[]>} revokeForUser Revoca todas las sesiones activas del usuario, sin truncar por paginación. Comparte la transacción recibida y devuelve sólo datos administrativos, sin tokens ni permisos.
 * @property {function(Object, (string|symbol)=):Promise<Object|null>} close Una escritura condicional cierra sólo una sesión activa; devuelve null si otra operación ya la cerró. No reactiva sesiones.
 * @property {function(string, number, number):Promise<Object>} refreshAccess Actualiza último acceso con el reloj y la frecuencia de Security; la condición exige una sesión todavía activa y no cambia su caducidad.
 */

/**
 * @typedef {Object} AuthenticationReader
 * @property {function(Object):Promise<Object|null>} read Lee sesión, cuenta, workspace y permisos opcionales en un único snapshot vigente. Devuelve una proyección privada o null si falta la sesión; referencias ausentes quedan en null. Hereda la transacción activa, conserva filtros estructurales y límites de códigos; propaga fallos sin entregar identidad parcial. No almacena resultados entre peticiones ni devuelve credenciales de la cuenta.
 */

/**
 * @typedef {Object} IdentityAuthorizationReader
 * @property {function(Object):Promise<Object|null>} read Lee cuenta, sesión y códigos de workspaces en un único snapshot vigente, heredando la transacción activa. Recibe userCode, sessionCode y now; devuelve referencias privadas mínimas sin credenciales o null si la sesión falta. Aplica políticas estructurales, no almacena autorizaciones y propaga fallos de persistencia.
 */

/**
 * @typedef {Object} AuthorizationReader
 * @property {function(Object, symbol):Promise<Object[]>} readAccess Lectura interna por hasta 10000 códigos explícitos, sin conteos ni páginas; sólo admite el marcador guest, aplica la política y proyecta policies o identifier. No almacena permisos entre solicitudes; errores o cardinalidad inesperada fallan cerrado.
 */

/**
 * @typedef {Object} SecurityIntegrity
 * @property {function(string):Promise<boolean>} hasAssignedUsers Comprueba referencias a un grupo sin devolver cuentas, contando también referencias históricas.
 * @property {function(string):Promise<boolean>} hasReferences Comprueba referencias al recurso sin modificar otras entidades ni excluir silenciosamente referencias históricas.
 * @property {function(string, symbol):Promise<boolean>} hasRoleReference Exige el marcador interno de autorización y devuelve sólo la existencia de referencias al rol; otros alcances rechazan 403.
 */

/**
 * @typedef {Object} SessionAdministrativeReader
 * @property {function(Object, (string|symbol)):Promise<string[]>} getAdministrativeRoleCodes Obtiene sólo roles de sesiones visibles, aplicando autorización antes de resolver etiquetas.
 * @property {function(Object, Object, Map<string,string>, (string|symbol)):Promise<{listItem:Object[],totalCount:number}>} getAdministrativeList Filtra, ordena y pagina el conjunto completo después de aplicar etiquetas y referencias mínimas; devuelve registros de aplicación sin credenciales.
 */

/**
 * Las listas siguientes reúnen capacidades obligatorias de la composición completa, no una interfaz
 * que todos los casos de uso deban recibir. Cada grupo de operaciones documenta y prueba sus lectores,
 * escritores o capacidades transaccionales mínimos. Las sesiones son opacas y sólo la composición
 * técnica conoce su implementación; los casos de uso nunca crean conexiones ni hacen commit directo.
 * Las implementaciones propagan fallos de disponibilidad sin convertirlos en ausencia y conservan
 * la señal uncertain cuando un efecto puede haberse producido. Los puertos no reintentan escrituras.
 */
const REPOSITORY_CAPABILITIES = Object.freeze({
  identityAuthorization : Object.freeze(['read']),
  authentication        : Object.freeze(['read']),
  user                  : Object.freeze([
    'getOne',
    'getList',
    'getReferences',
    'create',
    'update',
    'updateItem',
    'hasRoleReference',
    'markDeleted',
    'lockForSession',
  ]),
  session               : Object.freeze([
    'getOne',
    'getList',
    'create',
    'update',
    'updateItem',
    'close',
    'revokeForUser',
    'refreshAccess',
    'getAdministrativeRoleCodes',
    'getAdministrativeList',
  ]),
  group                 : Object.freeze([
    'readAccess',
    'getOne',
    'getList',
    'create',
    'update',
    'updateItem',
    'deleteOne',
    'hasAssignedUsers',
  ]),
  policy                : Object.freeze([
    'readAccess',
    'getOne',
    'getList',
    'create',
    'updateItem',
    'deleteOne',
    'hasReferences',
    'getDistinct',
  ]),
  workspaces            : Object.freeze([
    'getOne',
    'getList',
    'getReferences',
    'create',
    'update',
    'updateItem',
    'deleteOne',
    'hasReferences',
  ]),
});

module.exports = { REPOSITORY_CAPABILITIES };
