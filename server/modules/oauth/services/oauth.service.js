/** @file Consentimiento OAuth, revocación y principales delegados con membresía y permisos vigentes. */
'use strict';
const { ApplicationError }          = require('../../../shared/application-error');
const { SCOPES, delegatedPolicies } = require('../policies/oauth-scope.policy');
/** @param {Object} dependencies Persistencia, identidad vigente y reloj. @returns {Object} Casos de uso sin dependencias técnicas. */
function oauthService({ store, identities, account, context, now, workspaceReferences }) {
  /** @param {string} source Origen acreditado. @returns {void} Sólo Gateway administra el protocolo OAuth. */
  function gateway(source) {
    if (source !== 'service-apigateway') throw new ApplicationError(403, 'OAUTH_ORIGIN_FORBIDDEN');
  }
  /** @param {Object} row Concesión privada. @returns {Object} Representación pública sin permisos ni artefactos del proveedor. */
  function present(row) {
    const { code, clientId, clientName, workspaces, scopes, active, createdAt, expiresAt } = row;
    return {
      code,
      clientId,
      clientName,
      workspaces,
      scopes,
      active   : active && expiresAt > now(),
      createdAt,
      expiresAt,
      revision : Number(row.revision) || 0,
    };
  }
  /** @param {string} source Origen acreditado. @param {boolean} read Lectura propia desde Platform. @returns {Promise<Object>} Sesión humana vigente; una delegación no puede otorgar otra. */
  async function human(source, read = false) {
    if (!read || source !== 'service-platform') gateway(source);
    if (context().delegation || context().actorType === 'agent')
      throw new ApplicationError(403, 'OAUTH_HUMAN_REQUIRED');
    const actor = await identities.current(source);
    const user  = await account(actor.userCode);
    if (!user) throw new ApplicationError(401, 'UNAUTHORIZED');
    return {
      ...actor,
      credentialsChangedAt : user.credentialsChangedAt,
    };
  }
  /** @param {Object} data Concesión y espacio solicitado. @param {string} source Servicio acreditado. @returns {Promise<Object>} Principal actual; no acepta identidad o políticas del solicitante. */
  async function resolve(data, source) {
    if (
      ![
        'service-apigateway',
        'service-security',
        'service-communication',
        'service-customer',
        'service-product',
        'service-quotation',
        'service-directory',
        'service-documents',
        'service-projects',
        'service-billing',
        'service-connect',
        'service-platform',
      ].includes(source)
    )
      throw new ApplicationError(403, 'OAUTH_ORIGIN_FORBIDDEN');
    const grant = await store.getGrant(data.grantCode);
    const user  = grant && (await account(grant.userCode));
    if (
      !grant?.active ||
      grant.expiresAt <= now() ||
      !user ||
      user.credentialsChangedAt !== grant.credentialsChangedAt ||
      (data.clientId && data.clientId !== grant.clientId)
    )
      throw new ApplicationError(401, 'OAUTH_CONNECTION_REVOKED');
    const available = [];
    const snapshots = [];
    for (const snapshot of grant.snapshots) {
      const result    = await identities.principals(
        {
          workspace : snapshot.workspace,
          userCodes : [grant.userCode],
        },
        'service-security',
      );
      const principal = result.items[0];
      if (!principal) continue;
      available.push(snapshot.workspace);
      snapshots.push({
        workspace : snapshot.workspace,
        policies  : principal.policies.filter(
          /** @param {string} policy Permiso actual. @returns {boolean} Estaba autorizado al otorgar la conexión. */
          (policy) => snapshot.policies.includes(policy),
        ),
      });
    }
    if (!available.length) throw new ApplicationError(403, 'OAUTH_WORKSPACE_FORBIDDEN');
    const workspace = data.workspace || (available.length === 1 ? available[0] : '');
    if (workspace && !available.includes(workspace))
      throw new ApplicationError(403, 'OAUTH_WORKSPACE_FORBIDDEN');
    const selected         = snapshots.find(
      /** @param {Object} value Instantánea vigente. @returns {boolean} Espacio seleccionado. */
      (value) => value.workspace === workspace,
    );
    const workspaceDetails = [];
    if (data.includeWorkspaceDetails) {
      const references = await workspaceReferences(available);
      for (const reference of references)
        if (available.includes(reference.workspaceCode))
          workspaceDetails.push({
            workspaceCode : reference.workspaceCode,
            name          : typeof reference.name === 'string' ? reference.name : '',
          });
    }
    return {
      projectsAuthorization : grant.projectsAuthorization === 'team' ? 'team' : 'legacy',
      userCode              : grant.userCode,
      clientId              : grant.clientId,
      grantCode             : grant.code,
      workspace,
      workspaces            : available,
      ...(data.includeWorkspaceDetails ? { workspaceDetails } : {}),
      policies              : selected?.policies || [],
      scopes                : grant.scopes.filter(
        /** @param {string} scope Capacidad consentida. @returns {boolean} Sigue disponible en el espacio elegido o en alguno de los consentidos. */
        (scope) =>
          scope.startsWith('projects:') && scope !== 'projects:catalog'
            ? grant.projectsAuthorization === 'team'
            : scope.startsWith('projects:') && grant.projectsAuthorization !== 'team'
              ? false
              : scope === 'references:read' ||
                (grant.projectsAuthorization === 'team' &&
                  ['communication:timeline-read', 'communication:timeline-write'].includes(
                    scope,
                  )) ||
                (selected ? [selected] : snapshots).some(
                  /** @param {Object} snapshot Permisos actuales. @returns {boolean} Al menos un permiso de la capacidad sigue vigente. */
                  (snapshot) => delegatedPolicies(snapshot.policies, [scope]).length > 0,
                ),
      ),
      expiresAt             : grant.expiresAt,
    };
  }
  return {
    resolve,
    /** @param {Object} data Metadatos cerrados de ejecución. @param {string} source Gateway acreditado. @returns {Promise<Object>} Auditoría sin argumentos ni respuestas de negocio. */
    async recordExecution(data, source) {
      gateway(source);
      const grant = await store.getGrant(data.grantCode);
      if (
        !grant ||
        grant.userCode !== data.userCode ||
        grant.clientId !== data.clientId ||
        !grant.workspaces.includes(data.workspace)
      )
        throw new ApplicationError(403, 'OAUTH_EXECUTION_MISMATCH');
      await store.recordExecution({
        ...data,
        createdAt : now(),
      });
      return { ok: true };
    },
    /** @param {Object} data Entrada vacía. @param {string} source Origen. @returns {Promise<Object>} Administración explícita por permisos vigentes. */
    async clientAuthorize(data, source) {
      const actor  = await human(source);
      const result = await identities.principals(
        {
          workspace : actor.workspace,
          userCodes : [actor.userCode],
        },
        'service-security',
      );
      if (!result.items[0]?.policies.includes('security.settings.update.global'))
        throw new ApplicationError(403, 'FORBIDDEN');
      return { ok: true };
    },
    /** @param {Object} data Identidad del proveedor. @param {string} source Origen. @returns {Promise<Object>} Cuenta apta para OAuth. */
    async accountGet(data, source) {
      gateway(source);
      const user = await account(data.userCode);
      if (!user) throw new ApplicationError(401, 'UNAUTHORIZED');
      return { userCode: data.userCode };
    },
    /** @param {Object} data Selector privado. @param {string} source Origen. @returns {Promise<Object>} Estado del proveedor serializado. */
    async storageGet(data, source) {
      gateway(source);
      return { record: await store.get(data, now()) };
    },
    /** @param {Object} data Artefacto privado del proveedor. @param {string} source Origen. @returns {Promise<Object>} Confirmación. */
    async storagePut(data, source) {
      gateway(source);
      await store.put(data, now());
      return { ok: true };
    },
    /** @param {Object} data Artefacto. @param {string} source Origen. @returns {Promise<Object>} Consumo exclusivo. */
    async storageConsume(data, source) {
      gateway(source);
      const consumed = await store.consume(data, now());
      return { consumed };
    },
    /** @param {Object} data Artefacto. @param {string} source Origen. @returns {Promise<Object>} Confirmación. */
    async storageDestroy(data, source) {
      gateway(source);
      await store.destroy(data);
      return { ok: true };
    },
    /** @param {Object} data Familia del proveedor. @param {string} source Origen. @returns {Promise<Object>} Revocación técnica, incluida reutilización. */
    async familyRevoke(data, source) {
      gateway(source);
      await store.revoke(data.grantCode);
      return { ok: true };
    },
    /** @param {Object} data Consentimiento presentado al usuario. @param {string} source Origen. @returns {Promise<Object>} Concesión pública. */
    async grantCreate(data, source) {
      const actor = await human(source);
      if (
        !data.scopes.length ||
        data.scopes.some(
          /** @param {string} scope Capacidad. @returns {boolean} Capacidad desconocida. */
          (scope) => !SCOPES.includes(scope),
        )
      )
        throw new ApplicationError(400, 'OAUTH_SCOPE_INVALID');
      const selected = data.workspaces;
      if (
        !selected.length ||
        selected.some(
          /** @param {string} workspace Selección. @returns {boolean} Espacio no autorizado. */
          (workspace) => !actor.workspaces.includes(workspace) || workspace === 'allWorkspaces',
        )
      )
        throw new ApplicationError(403, 'OAUTH_WORKSPACE_FORBIDDEN');
      const snapshots = [];
      for (const workspace of selected) {
        const result = await identities.principals(
          {
            workspace,
            userCodes : [actor.userCode],
          },
          'service-security',
        );
        if (!result.items[0]) throw new ApplicationError(403, 'OAUTH_WORKSPACE_FORBIDDEN');
        snapshots.push({
          workspace,
          policies : delegatedPolicies(result.items[0].policies, data.scopes),
        });
      }
      const grant = {
        code                  : data.grantCode,
        userCode              : actor.userCode,
        clientId              : data.clientId,
        clientName            : data.clientName,
        workspaces            : [...new Set(selected)],
        scopes                : [...new Set(data.scopes)],
        snapshots,
        projectsAuthorization : 'team',
        credentialsChangedAt  : actor.credentialsChangedAt,
        revision              : 1,
        active                : true,
        createdAt             : now(),
        expiresAt             : now() + 30 * 86400000,
      };
      await store.createGrant(grant);
      return present(grant);
    },
    /** @param {Object} data Paginación. @param {string} source Origen. @returns {Promise<Object>} Sólo conexiones propias. */
    async grantList(data, source) {
      const actor = await human(source, true);
      return { items: (await store.listGrants(actor.userCode, data.page || 1)).map(present) };
    },
    /** @param {Object} data Concesión propia. @param {string} source Origen. @returns {Promise<Object>} Revocación inmediata y repetible. */
    async grantRevoke(data, source) {
      const actor = await human(source),
        grant     = await store.getGrant(data.grantCode);
      if (!grant || grant.userCode !== actor.userCode)
        throw new ApplicationError(404, 'OAUTH_CONNECTION_NOT_FOUND');
      await store.revoke(grant.code);
      return { ok: true };
    },
    /** @param {Object} actor Contexto interno. @param {string} source Servicio acreditado. @returns {Promise<Object>} Identidad canónica para consultas encadenadas. */
    async current(actor, source) {
      const principal = await resolve(
        {
          grantCode : actor.delegation.grantCode,
          clientId  : actor.delegation.clientId,
          workspace : actor.workspace,
        },
        source,
      );
      if (actor.user?.userCode !== principal.userCode || !principal.workspace)
        throw new ApplicationError(401, 'UNAUTHORIZED');
      return {
        userCode   : principal.userCode,
        workspace  : principal.workspace,
        workspaces : principal.workspaces,
        policies   : principal.policies,
        delegation : { ...actor.delegation },
      };
    },
  };
}
module.exports = { oauthService };
