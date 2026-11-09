/** @file Casos de uso de consulta del recurso session; preservan autorizaciones, resultados y efectos existentes. */
'use strict';
/** Compone las operaciones de consulta con sus colaboradores explícitos.
 * @param {Object} dependencies Capacidades mínimas utilizadas por este grupo de operaciones.
 * @returns {Object} Operaciones de aplicación sin construir implementaciones técnicas.
 */
function sessionQueriesWorkflowService({
  ApplicationError,
  FIELDS,
  administrativeFilter,
  administrativeSession,
  dependencies,
  detailService,
  messaging,
  sessionListDTO,
  sessionRepository,
  utilities,
}) {
  return {
    /** Consulta administrativa; una proyección solicitada nunca amplía los campos públicos.
     * @param {string} code Identificador público del recurso.
     * @param {string|symbol} [scope] Alcance solicitado o marcador interno de confianza.
     * @returns {Promise<*>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async getOne(code, scope = '') {
      const record = await administrativeSession(code, scope);
      return record ? detailService().get(record) : null;
    },
    /**
     * Consulta una página de registros autorizados.
     * @param {Object} data Datos de entrada de la operación.
     * @returns {Promise<Object>} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
     */
    async getList(data) {
      if (!data || typeof data !== 'object' || Array.isArray(data))
        throw new ApplicationError(400, 'INVALID_INPUT');
      const scope = data.scope === undefined ? '' : data.scope;
      if (typeof scope !== 'string' && typeof scope !== 'symbol')
        throw new ApplicationError(400, 'INVALID_SCOPE');
      const condition = { $and: [{}] };
      const now       = Date.now() / 1000;
      if (data.status !== undefined) {
        if (!['all', 'active', 'expired', 'closed'].includes(data.status))
          throw new ApplicationError(400, 'INVALID_SESSION_STATE');
        if (data.status === 'closed') condition.$and.push({ active: false });
        if (data.status === 'active')
          condition.$and.push({
            active     : true,
            expiration : { $gt: now },
          });
        if (data.status === 'expired')
          condition.$and.push({
            active     : true,
            expiration : { $lte: now },
          });
      } else if (data.active !== 'active|inactive') {
        condition.$and.push({
          active : data.active === 'inactive' ? false : true,
        });
      }
      if (data.userCode) {
        if (typeof data.userCode !== 'string') throw new ApplicationError(400, 'INVALID_USER_CODE');
        condition.$and.push({ userCode: data.userCode });
      }
      if (data.roleCode) {
        if (typeof data.roleCode !== 'string') throw new ApplicationError(400, 'INVALID_ROLE_CODE');
        condition.$and.push({ roleCode: { $in: data.roleCode.split('|') } });
      }
      for (const key of ['search', 'user']) {
        if (
          data[key] !== undefined &&
          (typeof data[key] !== 'string' || data[key].length > (key === 'user' ? 254 : 200))
        )
          throw new ApplicationError(400, key === 'user' ? 'INVALID_USER' : 'INVALID_SEARCH');
      }
      for (const [key, operator] of [
        ['from', '$gte'],
        ['to', '$lte'],
      ]) {
        if (data[key] !== undefined && data[key] !== '') {
          if (!Number.isFinite(Number(data[key])) || Number(data[key]) < 0)
            throw new ApplicationError(400, 'INVALID_DATE_RANGE');
          condition.$and.push({ start: { [operator]: Number(data[key]) } });
        }
      }
      if (data.from && data.to && Number(data.from) > Number(data.to))
        throw new ApplicationError(400, 'INVALID_DATE_RANGE');
      if (data.dateRange) {
        if (typeof data.dateRange !== 'string')
          throw new ApplicationError(400, 'INVALID_DATE_RANGE');
        const dates = data.dateRange.split('|');
        for (const [index, operator] of [
          [0, '$gte'],
          [1, '$lte'],
        ])
          if (dates[index]) {
            if (!Number.isFinite(Number(dates[index])))
              throw new ApplicationError(400, 'INVALID_DATE_RANGE');
            condition.$and.push({
              lastAccess : { [operator]: Number(dates[index]) },
            });
          }
      }
      if (data.sort && ![...FIELDS, 'user', 'roleName'].includes(data.sort))
        throw new ApplicationError(400, 'INVALID_SORT');
      const sort              = utilities.getSortQuery('start', data.sort || null, data.order || 'desc');
      const { page, perPage } = utilities.getPublicPagination(data);
      const filter            = administrativeFilter(condition, scope);
      const codes             = await sessionRepository.getAdministrativeRoleCodes(filter, scope);
      const labels            = await dependencies.roleLabels(messaging, codes);
      const result            = await sessionRepository.getAdministrativeList(
        filter,
        {
          sort,
          page,
          perPage,
          search : data.search?.trim() ? utilities.escapeRegex(data.search.trim()) : '',
          user   : data.user?.trim() ? utilities.escapeRegex(data.user.trim()) : '',
        },
        labels,
        scope,
      );
      return {
        pagination : {
          total : result.totalCount,
          page  : page + 1,
          perPage,
        },
        items      : result.listItem.map(
          /**
           * Proyecta cada elemento en la estructura requerida por la operación.
           * @param {*} item Valor de item utilizado por esta operación.
           * @returns {*} Resultado que utiliza el flujo que invoca esta función; los fallos se propagan según el contrato del módulo.
           */
          (item) => sessionListDTO(item),
        ),
      };
    },
  };
}
module.exports = { sessionQueriesWorkflowService };
