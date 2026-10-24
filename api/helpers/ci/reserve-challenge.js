const withDatastoreTransaction = require('../../lib/with-datastore-transaction')
const crypto = require('node:crypto')
module.exports = {
  friendlyName: 'Reserve CI challenge',
  description:
    'Serialize bounded app submissions with current policy and device trust.',
  inputs: {
    policy: { type: 'ref', required: true },
    runner: { type: 'ref', required: true },
    source: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ policy, runner, source }) {
    return withDatastoreTransaction(async (connection) => {
      const locked = await CiPolicy.updateOne({
        id: policy.id,
        revision: policy.revision,
        enabled: true
      })
        .set({ revision: policy.revision })
        .usingConnection(connection)
      const current = await CiRunner.findOne({
        id: runner.id,
        app: policy.app
      }).usingConnection(connection)
      if (
        !locked ||
        !current ||
        current.revokedAt != null ||
        current.policyRevision !== policy.revision
      )
        throw new Error('Runner trust or policy changed. Review it again.')
      const now = Date.now()
      if (
        (await CiRun.count({
          app: policy.app,
          state: 'pending',
          expiresAt: { '>': now }
        }).usingConnection(connection)) >= 10
      )
        throw new Error(
          'The app has ten unfinished submissions. Wait for a result or the five-minute submission expiry.'
        )
      // Retain the latest 200 source receipts and every receipt linked to a deployment.
      // Expired challenges cannot contribute evidence and are removed after an hour.
      const old = await CiRun.find({
        app: policy.app,
        expiresAt: { '<': now - 3600000 }
      })
        .sort('createdAt DESC')
        .skip(200)
        .limit(200)
        .usingConnection(connection)
      if (old.length) {
        const linked = await CiVerification.find({
          run: old.map((item) => item.id)
        })
          .select(['run'])
          .usingConnection(connection)
        const ids = old
          .filter((item) => !linked.some((link) => link.run === item.id))
          .map((item) => item.id)
        if (ids.length)
          await CiRun.destroy({ id: ids }).usingConnection(connection)
      }
      // Hard cap bounds a burst even before retention becomes eligible.
      if (
        (await CiRun.count({
          app: policy.app,
          createdAt: { '>': now - 3600000 }
        }).usingConnection(connection)) >= 200
      )
        throw new Error(
          'This app reached 200 submissions in an hour. Reuse an existing report and retry after the oldest submission expires.'
        )
      const challenge = {
        version: 1,
        configuration: policy.configuration.execution,
        runId: crypto.randomUUID(),
        nonce: crypto.randomBytes(32).toString('base64url'),
        appId: String(policy.app),
        runnerId: runner.runnerId,
        policyRevision: policy.revision,
        commit: source.commit,
        tree: source.tree,
        manifestDigest: source.manifestDigest,
        lockDigest: source.lockDigest,
        issuedAt: now,
        expiresAt: now + 300000
      }
      await CiRun.create({
        runId: challenge.runId,
        app: policy.app,
        runner: runner.id,
        policyRevision: policy.revision,
        commit: source.commit,
        challenge,
        expiresAt: challenge.expiresAt
      }).usingConnection(connection)
      return challenge
    })
  }
}
