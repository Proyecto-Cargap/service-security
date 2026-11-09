/** @file Acredita la retirada idempotente de políticas de emisor sin ampliar permisos ni cambiar otras políticas. */
'use strict';
const test                   = require('node:test');
const assert                 = require('node:assert/strict');
const mongoose               = require('mongoose');
const { startIsolatedMongo } = require('./helpers/isolated-mongo.cjs');
const { retire }             = require('../ops/retire-issuer-user-policies.cjs');
const binary                 = process.env.TEST_MONGOD_BINARY;
test(
  'Security retira owner/assigned de emisores y conserva los permisos de otros recursos',
  { skip: !binary },
  /** @returns {Promise<void>} Utiliza exclusivamente una base efímera con proceso propio. */
  async () => {
    const mongo = await startIsolatedMongo({
      binary,
      mongoose,
    });
    try {
      const db = mongo.connection.db,
        client = mongo.connection.getClient();
      await db.collection('SECURITY_POLICY').insertMany([
        {
          policyCode : 'old',
          identifier : 'billing.issuer.view.owner',
          active     : true,
          erased     : false,
        },
        {
          policyCode : 'keep',
          identifier : 'billing.document.view.owner',
          active     : true,
          erased     : false,
        },
      ]);
      await db.collection('SECURITY_GROUP').insertOne({
        groupCode : 'G1',
        policies  : ['old', 'keep'],
      });
      assert.equal((await retire(db, client)).groups, 1);
      assert.deepEqual(
        (await db.collection('SECURITY_GROUP').findOne({ groupCode: 'G1' })).policies,
        ['old', 'keep'],
      );
      await retire(db, client, true);
      assert.deepEqual(
        (await db.collection('SECURITY_GROUP').findOne({ groupCode: 'G1' })).policies,
        ['keep'],
      );
      assert.equal(
        (await db.collection('SECURITY_POLICY').findOne({ policyCode: 'old' })).active,
        false,
      );
      assert.equal(
        (await db.collection('SECURITY_POLICY').findOne({ policyCode: 'keep' })).active,
        true,
      );
      assert.equal((await retire(db, client, true)).groups, 0);
    } finally {
      await mongo.stop();
    }
  },
);
