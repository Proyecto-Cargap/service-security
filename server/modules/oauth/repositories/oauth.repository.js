/** @file Persistencia privada de OAuth con consumo atómico, vencimientos y revocación de familias. */
'use strict';
/** @param {Object} options Conexión MongoDB y digest inyectados. @returns {Object} Puerto de almacenamiento del proveedor y concesiones. */
function oauthRepository({ db, digest, transaction, publishEvent, readSession }) {
  /** @param {string} model Tipo de registro. @param {string} id Identificador privado. @returns {string} Clave que no conserva el token original. */
  function key(model, id) {
    return digest(`${model}:${id}`);
  }
  /** @returns {Object} Colección disponible después del arranque. */
  function records() {
    return db().collection('SECURITY_OAUTH_RECORD');
  }
  /** @returns {Object} Concesiones de usuario independientes de sesiones web. */
  function grants() {
    return db().collection('SECURITY_OAUTH_GRANT');
  }
  return {
    /** @returns {Promise<void>} Índice del vencimiento concreto, sin barrer pendientes. */
    async prepareExpiration() {
      await grants().createIndex(
        {
          active    : 1,
          expiresAt : 1,
          code      : 1,
        },
        { name: 'oauth_grant_expiration' },
      );
    },
    /** @returns {Promise<number|undefined>} Próximo vencimiento; se consulta al arrancar, ante cambios y al vencer un plazo conocido. */
    async nextExpirationAt() {
      const item = await grants().findOne(
        {
          active    : true,
          expiresAt : {
            $type : 'number',
            $gte  : 0,
          },
        },
        {
          projection : { expiresAt: 1 },
          sort       : {
            expiresAt : 1,
            code      : 1,
          },
        },
      );
      return item?.expiresAt;
    },
    /** @param {number} now Reloj del productor. @returns {Promise<boolean>} Una transición cercada por estado y vencimiento; outbox y revocación de artefactos son atómicos. */
    async expireDue(now) {
      return transaction(
        /** @param {Object} session Transacción MongoDB. @returns {Promise<boolean>} Sólo la instancia que cambia el estado publica. */
        async (session) => {
          const grant = await grants().findOneAndUpdate(
            {
              active    : true,
              expiresAt : {
                $gte : 0,
                $lte : now,
              },
            },
            {
              $set : { active: false },
              $inc : { revision: 1 },
            },
            {
              session,
              sort           : {
                expiresAt : 1,
                code      : 1,
              },
              returnDocument : 'after',
            },
          );
          if (!grant) return false;
          await records().deleteMany({ grantId: grant.code }, { session });
          await publishEvent(
            'security.access.changed',
            {
              resource : 'grant',
              code     : grant.code,
              userCode : grant.userCode,
              revision : grant.revision,
            },
            { session },
          );
          return true;
        },
      );
    },
    /** @param {Object} record Metadatos sin datos comerciales. @returns {Promise<void>} Traza de ejecución con retención de noventa días. */
    async recordExecution(record) {
      await db()
        .collection('SECURITY_OAUTH_EXECUTION')
        .updateOne(
          { operationCode: record.operationCode },
          {
            $setOnInsert : {
              ...record,
              expiresAt : new Date(record.createdAt + 90 * 86400000),
            },
          },
          { upsert: true },
        );
    },
    /** @param {Object} input Selector privado. @param {number} now Instante actual. @returns {Promise<Object|null>} Registro vigente. */
    async get(input, now) {
      const query = input.uid
        ? {
            model : input.model,
            uid   : input.uid,
          }
        : { _id: key(input.model, input.id) };
      const value = await records().findOne({
        ...query,
        expiresAt : { $gt: new Date(now) },
      });
      return value
        ? {
            payload  : value.payload,
            consumed : value.consumed || 0,
          }
        : null;
    },
    /** @param {Object} input Sobre privado validado. @param {number} now Instante actual. @returns {Promise<void>} Guarda sólo los campos necesarios para el proveedor. */
    async put(input, now) {
      await records().updateOne(
        { _id: key(input.model, input.id) },
        {
          $set : {
            model     : input.model,
            payload   : input.payload,
            uid       : input.uid || '',
            grantId   : input.grantId || '',
            expiresAt : new Date(now + input.ttl * 1000),
          },
        },
        { upsert: true },
      );
    },
    /** @param {Object} input Registro. @param {number} now Instante actual. @returns {Promise<boolean>} Sólo una ejecución puede consumir el código. */
    async consume(input, now) {
      const result = await records().updateOne(
        {
          _id       : key(input.model, input.id),
          consumed  : { $exists: false },
          expiresAt : { $gt: new Date(now) },
        },
        { $set: { consumed: Math.floor(now / 1000) } },
      );
      return result.modifiedCount === 1;
    },
    /** @param {Object} input Registro privado. @returns {Promise<void>} Destruye el artefacto del proveedor. */
    async destroy(input) {
      await records().deleteOne({ _id: key(input.model, input.id) });
    },
    /** @param {string} grantCode Concesión. @returns {Promise<void>} Revoca familia completa y autorización de dominio. */
    async revoke(grantCode) {
      await transaction(
        /** @param {Object} session Transacción del productor. @returns {Promise<void>} La familia y su aviso se confirman o revierten juntos. */
        async (session) => {
          const grant = await grants().findOneAndUpdate(
            {
              code   : grantCode,
              active : true,
            },
            {
              $set : { active: false },
              $inc : { revision: 1 },
            },
            {
              session,
              returnDocument : 'after',
            },
          );
          await records().deleteMany({ grantId: grantCode }, { session });
          if (grant)
            await publishEvent(
              'security.access.changed',
              {
                resource : 'grant',
                code     : grantCode,
                userCode : grant.userCode,
                revision : grant.revision,
              },
              { session },
            );
        },
      );
    },
    /** @param {Object} grant Consentimiento inmutable. @returns {Promise<void>} No sustituye una concesión existente. */
    async createGrant(grant) {
      await transaction(
        /** @param {Object} session Transacción del productor. @returns {Promise<void>} Registra el consentimiento y su referencia sin secretos. */
        async (session) => {
          await grants().insertOne(
            {
              ...grant,
              revision : 1,
            },
            { session },
          );
          await publishEvent(
            'security.access.changed',
            {
              resource : 'grant',
              code     : grant.code,
              userCode : grant.userCode,
              revision : 1,
            },
            { session },
          );
        },
      );
    },
    /** @param {string} code Concesión. @returns {Promise<Object|null>} Registro plano privado. */
    async getGrant(code) {
      const value = await grants().findOne({ code }, { session: readSession?.() });
      if (!value) return null;
      const { _id: internalId, ...result } = value;
      return result;
    },
    /** @param {string} userCode Titular. @param {number} page Página. @returns {Promise<Object[]>} Página estable de conexiones propias. */
    async listGrants(userCode, page) {
      return grants()
        .find(
          { userCode },
          {
            projection : { _id: 0 },
            session    : readSession?.(),
          },
        )
        .sort({
          createdAt : -1,
          code      : 1,
        })
        .skip((page - 1) * 50)
        .limit(50)
        .toArray();
    },
  };
}
module.exports = { oauthRepository };
