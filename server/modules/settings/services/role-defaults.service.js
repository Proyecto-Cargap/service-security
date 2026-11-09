/** @file Valida y resuelve perfiles predeterminados e integridad de sus referencias mediante lectores inyectados. */
'use strict';
const { ApplicationError }            = require('../../../shared/application-error');
const { validateDefaultGroupsByRole } = require('../contracts/settings.contract');

/** Construye reglas de asignación sin acceso directo a infraestructura.
 * @param {Object} dependencies Lectores readSettings(), readGroup(code, internal) y readRole(code).
 * @returns {Object} Validación, resolución e integridad; propaga fallos de lectura sin convertirlos en ausencia.
 */
function roleDefaultsService({ readSettings, readGroup, readRole }) {
  if (
    typeof readSettings !== 'function' ||
    typeof readGroup !== 'function' ||
    typeof readRole !== 'function'
  )
    throw new TypeError('INVALID_ROLE_DEFAULTS_READERS');
  /** Comprueba un perfil vigente y global antes de asignarlo.
   * @param {string} code Código de perfil.
   * @param {boolean} internal Si la asignación proviene de configuración ya autorizada.
   * @returns {Promise<void>} Rechaza referencias inexistentes o fuera del ámbito global.
   */
  async function validateGroup(code, internal) {
    const group = await readGroup(code, internal);
    if (!group || group.erased === true || group.workspace !== 'allWorkspaces')
      throw new ApplicationError(409, 'INVALID_DEFAULT_GROUP');
  }
  return {
    /** Valida el catálogo completo enviado por un administrador autorizado.
     * @param {Array<{roleCode:string,groupCodes:string[]}>} mappings Asignaciones únicas por rol.
     * @returns {Promise<void>} Comprueba roles y perfiles antes de cualquier escritura.
     */
    async validate(mappings) {
      validateDefaultGroupsByRole(mappings);
      const seen = new Set();
      for (const mapping of mappings) {
        const role = await readRole(mapping.roleCode);
        if (!role || role.erased === true || role.active === false)
          throw new ApplicationError(409, 'INVALID_DEFAULT_ROLE');
        for (const code of mapping.groupCodes) {
          if (!seen.has(code)) await validateGroup(code, false);
          seen.add(code);
        }
      }
    },
    /** Resuelve exclusivamente el rol solicitado sobre la instantánea de configuración del alta.
     * @param {Object} record Configuración de usuarios previamente leída.
     * @param {string} roleCode Rol de la cuenta nueva.
     * @returns {Promise<string[]>} Perfiles verificados; campo ausente o rol sin asignación devuelve [].
     */
    async resolve(record, roleCode) {
      const mappings =
        record?.data?.defaultGroupsByRole === undefined ? [] : record.data.defaultGroupsByRole;
      validateDefaultGroupsByRole(mappings);
      const directoryRole = {
        '100-customer' : 'ROL-200-CUSTOMER',
        '300-supplier' : 'ROL-300-SUPPLIER',
      }[roleCode];
      const mapping       =
        mappings.find(
          /** @param {Object} item Asignación configurada. @returns {boolean} Coincidencia exacta del rol. */
          (item) => item.roleCode === roleCode,
        ) ||
        mappings.find(
          /** @param {Object} item Perfil del rol comercial. @returns {boolean} Equivalencia del alta móvil CARGAP. */
          (item) => directoryRole && item.roleCode === directoryRole,
        );
      const codes         = mapping?.groupCodes ?? [];
      for (const code of codes) await validateGroup(code, true);
      return [...codes];
    },
    /** Consulta referencias para impedir bajas y cambios de ámbito incompatibles.
     * @param {'role'|'group'} kind Catálogo referenciado.
     * @param {string} code Código cuya integridad se consulta.
     * @returns {Promise<boolean>} Existencia de una referencia, sin exponer el contenido de configuración.
     */
    async uses(kind, code) {
      const record   = await readSettings();
      const mappings =
        record?.data?.defaultGroupsByRole === undefined ? [] : record.data.defaultGroupsByRole;
      validateDefaultGroupsByRole(mappings);
      return mappings.some(
        /** @param {Object} item Asignación persistida. @returns {boolean} Referencia al código solicitado. */
        (item) => (kind === 'role' ? item.roleCode === code : item.groupCodes.includes(code)),
      );
    },
  };
}
module.exports = { roleDefaultsService };
