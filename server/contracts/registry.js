/** @file Registro completo de DTO por dominio; cada acción tiene entrada y salida explícitas. */
'use strict';
module.exports = Object.freeze(
  Object.assign(
    Object.create(null),
    require('../modules/oauth/dtos/oauth.actions.dto'),
    require('../modules/external-principal/dtos/external-principal.actions.dto'),
    require('../modules/agent-principal/dtos/agent-principal.actions.dto'),
    require('../modules/group/dtos/group.actions.dto'),
    require('../modules/identity/dtos/identity.actions.dto'),
    require('../modules/policy/dtos/policy.actions.dto'),
    require('../modules/session/dtos/session.actions.dto'),
    require('../modules/settings/dtos/settings.actions.dto'),
    require('../modules/system/dtos/system.actions.dto'),
    require('../modules/user/dtos/user.actions.dto'),
    require('../modules/workspaces/dtos/workspaces.actions.dto'),
  ),
);
