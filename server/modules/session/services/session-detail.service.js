/** @file Consulta de referencias administrativas y fotos después de autorizar la sesión concreta. */
'use strict';
const { ApplicationError }               = require('../../../shared/application-error');
const { trustedScopes: userScopes }      = require('../../user/policies/user.policy');
const { trustedScopes: workspaceScopes } = require('../../workspaces/policies/workspaces.policy');
const { sessionDetailPresenter }         = require('../presenters/session-detail.presenter');
/**
 * Ejecuta text dentro del flujo de session-detail.service.
 * @param {*} value Valor de value utilizado por esta operación.
 * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
 */
const text                               = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/** @param {Object} dependencies Repositorios propios y colaborador Directory. @returns {Object} Perfil y lectura de foto de una sesión ya autorizada. */
module.exports = function sessionDetailService({ messaging, users, workspaces, roleLabels }) {
  /**
   * Ejecuta user dentro del flujo de session-detail.service.
   * @param {*} record Valor de record utilizado por esta operación.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function user(record) {
    const result = await users.getList(
      {
        userCode : record.userCode,
        erased   : false,
      },
      {},
      0,
      1,
      'user contactCode',
      userScopes.guest,
    );
    return result.listItem[0] || null;
  }
  /**
   * Ejecuta workspace dentro del flujo de session-detail.service.
   * @param {*} record Valor de record utilizado por esta operación.
   * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function workspace(record) {
    if (!record.activeWorkspace) return null;
    const result = await workspaces.getList(
      {
        workspaceCode : record.activeWorkspace,
        erased        : false,
      },
      {},
      0,
      1,
      'name',
      workspaceScopes.guest,
    );
    return text(result.listItem[0]?.name);
  }
  /**
   * Ejecuta profile dentro del flujo de session-detail.service.
   * @param {*} account Valor de account utilizado por esta operación.
   * @returns {Promise<null|Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
   */
  async function profile(account) {
    if (!text(account?.contactCode)) return null;
    const result = await messaging.request(
      'service-directory',
      'contact-profile-get-one',
      { contactCode: account.contactCode },
      { timeoutMs: 5000 },
    );
    if (result?.statusCode !== 200) throw new Error('INVALID_SESSION_PROFILE_RESPONSE');
    if (result.data === null) return null;
    const value = result.data;
    if (
      !value ||
      !['fullName', 'job', 'department'].every(
        /**
         * Comprueba la condición requerida para cada elemento.
         * @param {string} key Clave del campo o recurso que se procesa.
         * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
         */
        (key) => typeof value[key] === 'string',
      ) ||
      typeof value.hasPicture !== 'boolean'
    )
      throw new Error('INVALID_SESSION_PROFILE_RESPONSE');
    return {
      fullName   : value.fullName.trim(),
      job        : value.job.trim(),
      department : value.department.trim(),
      hasPicture : value.hasPicture,
    };
  }
  return {
    /** @param {Object} record Sesión previamente autorizada. @returns {Promise<Object>} DTO positivo y referencias mínimas. */
    async get(record) {
      try {
        const account       = await user(record);
        const workspaceName = await workspace(record);
        const roles         = await roleLabels(messaging, record.roleCode ? [record.roleCode] : []);
        return sessionDetailPresenter({
          record,
          account,
          workspaceName,
          roleName : roles.get(record.roleCode) || null,
          profile  : await profile(account),
        });
      } catch (cause) {
        throw new ApplicationError(503, 'SESSION_REFERENCES_UNAVAILABLE', { cause });
      }
    },
    /** @param {Object} record Sesión autorizada de nuevo para esta lectura. @param {string} size Variante admitida. @returns {Promise<Object>} Temporal y MIME del contacto actualmente vinculado. */
    async picture(record, size) {
      const account = await user(record);
      if (!text(account?.contactCode)) throw new ApplicationError(404, 'CONTACT_PICTURE_NOT_FOUND');
      const result = await messaging.request(
        'service-directory',
        'contact-picture-read',
        {
          contactCode : account.contactCode,
          size,
        },
        { timeoutMs: 310000 },
      );
      if (result?.statusCode !== 200)
        throw new ApplicationError(
          result?.statusCode || 503,
          result?.descriptionCode || 'FILE_READ_FAILED',
        );
      return result.data;
    },
  };
};
