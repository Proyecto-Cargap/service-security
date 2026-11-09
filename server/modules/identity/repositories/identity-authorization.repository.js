/** @file Proyección privada de sesión, cuenta y membresías vigentes en un único snapshot de Security. */
'use strict';
const sessionPolicy   = require('../../session/policies/session.policy');
const userPolicy      = require('../../user/policies/user.policy');
const workspacePolicy = require('../../workspaces/policies/workspaces.policy');

/** @param {Object} options Modelos del propietario y contexto autenticado. @returns {Object} Lector sin caché ni efectos; hereda la transacción de la solicitud. */
function identityAuthorizationRepository({ session, user, workspace, messaging }) {
  /** @param {Object} policy Política del recurso. @param {Object} filter Criterios privados. @returns {Object} Filtro estructural autorizado por el marcador interno. */
  function authorized(policy, filter) {
    const result = policy.authorize(
      'view',
      filter,
      policy.trustedScopes.guest,
      messaging.getContext(),
    );
    if (!result) throw new Error('IDENTITY_FILTER_REQUIRED');
    return result;
  }
  return {
    /** @param {Object} input Identificadores acreditados y reloj de la petición. @returns {Promise<Object|null>} Referencias privadas mínimas; ausencia de sesión devuelve null y los fallos se propagan. */
    async read({ userCode, sessionCode, now }) {
      const rows = await session
        .aggregate([
          {
            $match : authorized(sessionPolicy, {
              userCode,
              sessionCode,
              active     : true,
              expiration : { $gt: now / 1000 },
            }),
          },
          { $limit: 1 },
          {
            $project : {
              userCode : 1,
              session  : {
                activeWorkspace          : '$activeWorkspace',
                workspaces               : '$workspaces',
                policies                 : '$policies',
                externalConversationCode : '$externalConversationCode',
              },
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
                    _id                      : 0,
                    userCode                 : 1,
                    userType                 : 1,
                    workspaces               : 1,
                    externalConversationCode : 1,
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
              localField   : 'user.workspaces',
              foreignField : 'workspaceCode',
              pipeline     : [
                { $match: authorized(workspacePolicy, { erased: false }) },
                {
                  $project : {
                    _id           : 0,
                    workspaceCode : 1,
                  },
                },
              ],
              as           : 'workspaces',
            },
          },
          {
            $project : {
              _id        : 0,
              user       : 1,
              session    : 1,
              workspaces : '$workspaces.workspaceCode',
            },
          },
        ])
        .readConcern('snapshot');
      return rows[0] || null;
    },
  };
}
module.exports = { identityAuthorizationRepository };
