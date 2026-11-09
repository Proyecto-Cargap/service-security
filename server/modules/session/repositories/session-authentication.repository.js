/** @file Lee la sesión, identidad y permisos vigentes en una sola consulta de Security, sin caché. */
'use strict';
const sessionPolicy        = require('../policies/session.policy');
const userPolicy           = require('../../user/policies/user.policy');
const workspacePolicy      = require('../../workspaces/policies/workspaces.policy');
const groupPolicy          = require('../../group/policies/group.policy');
const policyPolicy         = require('../../policy/policies/policy.policy');
const { ApplicationError } = require('../../../shared/application-error');

/** @param {Object|string} value Expresión de una lista interna. @returns {Object} Códigos únicos no vacíos; mantiene la normalización del caso de uso anterior. */
function stringCodes(value) {
  return {
    $setUnion : [
      {
        $filter : {
          input : { $cond: [{ $isArray: value }, value, []] },
          as    : 'code',
          cond  : { $and: [{ $eq: [{ $type: '$$code' }, 'string'] }, { $ne: ['$$code', ''] }] },
        },
      },
      [],
    ],
  };
}

/** @param {Object} options Modelos del mismo propietario y contexto acreditado. @returns {Object} Proyección privada, nunca un DTO público ni una autorización resuelta reutilizable. */
function sessionAuthenticationRepository({ session, user, workspace, group, policy, messaging }) {
  /** @param {Object} access Política canónica. @param {Object} filter Criterios internos. @returns {Object} Conserva las restricciones estructurales del lector anterior. */
  function authorized(access, filter) {
    const result = access.authorize(
      'view',
      filter,
      access.trustedScopes.guest,
      messaging.getContext(),
    );
    if (!result) throw new Error('AUTHENTICATION_FILTER_REQUIRED');
    return result;
  }
  return {
    /**
     * Consulta datos vigentes por petición; las uniones no cruzan servicios ni eliminan validaciones del caso de uso.
     * @param {Object} input Token ya verificado, usuario firmado, reloj y modalidad de permisos.
     * @returns {Promise<Object|null>} Sesión y referencias privadas; null indica sesión ausente. Propaga fallos de MongoDB.
     */
    async read({ token, userCode, now, currentPolicies }) {
      const pipeline = [
        {
          $match : authorized(sessionPolicy, {
            token,
            userCode,
            active     : true,
            expiration : { $gt: Math.floor(now / 1000) },
          }),
        },
        { $limit: 1 },
        {
          $project : {
            session  : {
              _id             : '$_id',
              sessionCode     : '$sessionCode',
              activeWorkspace : '$activeWorkspace',
              workspaces      : '$workspaces',
              policies        : '$policies',
              expiration      : '$expiration',
              lastAccess      : '$lastAccess',
            },
            userCode : 1,
          },
        },
        {
          $lookup : {
            from         : user.collection.name,
            localField   : 'userCode',
            foreignField : 'userCode',
            pipeline     : [
              {
                $match : authorized(userPolicy, {
                  erased   : false,
                  state    : 'active',
                  validity : { $gt: now },
                }),
              },
              {
                $project : {
                  _id                  : 0,
                  userCode             : 1,
                  userType             : 1,
                  state                : 1,
                  erased               : 1,
                  validity             : 1,
                  credentialsChangedAt : 1,
                  contactCode          : 1,
                  roleCode             : 1,
                  workspaces           : 1,
                  groups               : 1,
                },
              },
              { $limit: 1 },
            ],
            as           : 'users',
          },
        },
        { $set: { user: { $ifNull: [{ $first: '$users' }, null] } } },
        {
          $lookup : {
            from         : workspace.collection.name,
            localField   : 'session.activeWorkspace',
            foreignField : 'workspaceCode',
            pipeline     : [
              { $match: authorized(workspacePolicy, { erased: false }) },
              {
                $project : {
                  _id           : 0,
                  workspaceCode : 1,
                },
              },
              { $limit: 1 },
            ],
            as           : 'workspaces',
          },
        },
        { $set: { workspace: { $ifNull: [{ $first: '$workspaces' }, null] } } },
      ];
      if (currentPolicies)
        pipeline.push(
          { $set: { accessGroups: stringCodes('$user.groups') } },
          {
            $lookup : {
              from         : group.collection.name,
              localField   : 'accessGroups',
              foreignField : 'groupCode',
              pipeline     : [
                {
                  $match : authorized(groupPolicy, {
                    erased    : false,
                    groupCode : {
                      $type : 'string',
                      $ne   : '',
                    },
                  }),
                },
                {
                  $project : {
                    _id      : 0,
                    policies : 1,
                  },
                },
                { $limit: 10001 },
              ],
              as           : 'groups',
            },
          },
          {
            $set : {
              policyCodes : {
                $reduce : {
                  input        : '$groups',
                  initialValue : [],
                  in           : {
                    $setUnion : [
                      '$$value',
                      { $cond: [{ $isArray: '$$this.policies' }, '$$this.policies', []] },
                    ],
                  },
                },
              },
            },
          },
          { $set: { policyCodes: stringCodes('$policyCodes') } },
          {
            $lookup : {
              from         : policy.collection.name,
              localField   : 'policyCodes',
              foreignField : 'policyCode',
              pipeline     : [
                {
                  $match : authorized(policyPolicy, {
                    erased     : false,
                    active     : true,
                    policyCode : {
                      $type : 'string',
                      $ne   : '',
                    },
                  }),
                },
                {
                  $project : {
                    _id        : 0,
                    identifier : 1,
                  },
                },
                { $limit: 10001 },
              ],
              as           : 'permissions',
            },
          },
        );
      pipeline.push({
        $project : {
          _id       : 0,
          session   : 1,
          user      : 1,
          workspace : 1,
          policies  : '$permissions.identifier',
          ...(currentPolicies
            ? {
                accessGroups : 1,
                policyCodes  : 1,
                groupCount   : { $size: '$groups' },
                policyCount  : { $size: '$permissions' },
              }
            : {}),
        },
      });
      const rows = await session.aggregate(pipeline).readConcern('snapshot');
      const row  = rows[0];
      if (!row) return null;
      if (currentPolicies) {
        for (const codes of [row.accessGroups, row.policyCodes]) {
          if (
            codes.length > 10000 ||
            codes.some(
              /** @param {string} code Código privado. @returns {boolean} Conserva el límite del puerto readAccess. */ (
                code,
              ) => code.length > 100,
            )
          )
            throw new ApplicationError(400, 'INVALID_ACCESS_CODES');
        }
        if (row.groupCount > row.accessGroups.length || row.policyCount > row.policyCodes.length)
          throw new ApplicationError(409, 'ACCESS_CARDINALITY_CHANGED');
        delete row.accessGroups;
        delete row.policyCodes;
        delete row.groupCount;
        delete row.policyCount;
      }
      return row;
    },
  };
}
module.exports = { sessionAuthenticationRepository };
