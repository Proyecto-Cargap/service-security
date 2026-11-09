/** @file Capacidades delegables del servidor comercial y reducción de permisos por consentimiento. */
'use strict';
const SCOPES = Object.freeze([
  'communication:read',
  'communication:write',
  'communication:send',
  'communication:delete',
  'communication:read-state',
  'communication:upload',
  'communication:download',
  'communication:timeline-read',
  'communication:timeline-write',
  'customer:read',
  'customer:write',
  'customer:delete',
  'product:read',
  'product:write',
  'product:prices',
  'product:delete',
  'quotation:read',
  'quotation:write',
  'quotation:issue',
  'quotation:send',
  'quotation:cancel',
  'quotation:share',
  'references:read',
  'directory:read',
  'directory:write',
  'directory:delete',
  'directory:settings',
  'documents:read',
  'documents:write',
  'documents:delete',
  'documents:upload',
  'documents:download',
  'documents:settings',
  'projects:read',
  'projects:write',
  'projects:delete',
  'projects:catalog',
  'billing:read',
  'billing:write',
  'billing:issuers',
  'billing:issue',
  'billing:cancel',
  'billing:send',
  'billing:receipts',
  'billing:reconcile',
]);
/** @param {string} policy Permiso canónico. @returns {string|null} Capacidad que permite delegarlo. */
function scopeForPolicy(policy) {
  const [domain, resource, action] = policy.split('.');
  if (domain === 'communication') {
    if (resource === 'chat')
      return action === 'view'
        ? 'communication:read'
        : action === 'create'
          ? 'communication:write'
          : null;
    if (resource === 'timeline')
      return action === 'view'
        ? 'communication:timeline-read'
        : action === 'create'
          ? 'communication:timeline-write'
          : null;
    return null;
  }
  if (domain === 'customer') {
    if (resource === 'settings') return null;
    return `customer:${action === 'view' ? 'read' : action === 'delete' ? 'delete' : 'write'}`;
  }
  if (domain === 'product') {
    if (action === 'view') return 'product:read';
    if (action === 'delete') return 'product:delete';
    return ['price', 'price-list', 'assignment'].includes(resource)
      ? 'product:prices'
      : 'product:write';
  }
  if (domain === 'quotation')
    return `quotation:${
      {
        view    : 'read',
        create  : 'write',
        update  : 'write',
        issue   : 'issue',
        deliver : 'send',
        cancel  : 'cancel',
        share   : 'share',
      }[action] || 'unavailable'
    }`;
  if (domain === 'projects') {
    if (action === 'view') return 'projects:read';
    if (resource === 'project-type') return 'projects:catalog';
    return action === 'delete' ? 'projects:delete' : 'projects:write';
  }
  if (domain === 'billing') {
    if (['pac', 'csd'].includes(resource)) return null;
    if (action === 'view') return 'billing:read';
    return (
      {
        issuer       : 'billing:issuers',
        document     : 'billing:write',
        issuance     : 'billing:issue',
        cancellation : 'billing:cancel',
        delivery     : 'billing:send',
        receipt      : 'billing:receipts',
        operation    : 'billing:reconcile',
      }[resource] || null
    );
  }
  if (domain === 'directory') {
    if (resource === 'settings') return 'directory:settings';
    if (!['contact', 'role', 'job', 'department', 'businessline'].includes(resource)) return null;
    return `directory:${action === 'view' ? 'read' : action === 'delete' ? 'delete' : ['create', 'update'].includes(action) ? 'write' : 'unavailable'}`;
  }
  if (domain === 'documents') {
    if (resource === 'settings') return 'documents:settings';
    if (!['personal', 'workspace', 'global'].includes(resource)) return null;
    return `documents:${action === 'view' ? 'read' : action === 'delete' ? 'delete' : ['create', 'update'].includes(action) ? 'write' : 'unavailable'}`;
  }
  if (domain === 'security' && action === 'view') return 'references:read';
  return null;
}
/** @param {string[]} policies Permisos vigentes. @param {string[]} scopes Consentimiento. @returns {string[]} Intersección sin permisos administrativos implícitos. */
function delegatedPolicies(policies, scopes) {
  return policies.filter(
    /** @param {string} policy Permiso vigente. @returns {boolean} Concedido por el consentimiento. */
    (policy) =>
      scopes.includes(scopeForPolicy(policy)) ||
      (scopeForPolicy(policy) === 'communication:read' &&
        [
          'communication:send',
          'communication:delete',
          'communication:read-state',
          'communication:upload',
          'communication:download',
          'communication:write',
        ].some(
          /** @param {string} scope Capacidad específica de Chat. @returns {boolean} Permite verificar pertenencia sin ampliar herramientas públicas. */
          (scope) => scopes.includes(scope),
        )) ||
      (scopeForPolicy(policy) === 'communication:write' &&
        ['communication:send', 'communication:delete', 'communication:upload'].some(
          /** @param {string} scope Escritura específica. @returns {boolean} Conserva el permiso canónico de Chat. */
          (scope) => scopes.includes(scope),
        )) ||
      (scopeForPolicy(policy) === 'communication:timeline-read' &&
        (scopes.includes('communication:timeline-write') ||
          scopes.includes('communication:download'))) ||
      (policy.startsWith('directory.') &&
        policy.split('.')[2] === 'view' &&
        scopes.includes('references:read')) ||
      (scopeForPolicy(policy) === 'documents:read' && scopes.includes('documents:download')) ||
      (scopeForPolicy(policy) === 'documents:write' && scopes.includes('documents:upload')),
  );
}
module.exports = {
  SCOPES,
  delegatedPolicies,
};
