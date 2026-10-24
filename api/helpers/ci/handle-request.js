const crypto = require('node:crypto')
const contract = require('../../lib/contracts/ci-contract')
module.exports = {
  friendlyName: 'Handle local-first CI request',
  inputs: {
    req: { type: 'ref', required: true },
    target: { type: 'ref', required: true },
    operation: { type: 'string', required: true },
    data: { type: 'ref', defaultsTo: {} }
  },
  exits: { success: { outputType: 'ref' }, forbidden: {} },
  fn: async function ({ req, target, operation, data }) {
    const access = await sails.helpers.ci.resolveAccess
      .with({
        req,
        ...target,
        manage: !['runs'].includes(operation)
      })
      .tolerate('forbidden', () => null)
    if (!access) throw 'forbidden'
    const appId = access.app.id
    let policy = await CiPolicy.findOne({ app: appId })
    const get = req.method === 'GET'
    if (operation === 'runs' && get)
      return {
        runs: (
          await CiRun.find({ app: appId, completedAt: { '!=': null } })
            .sort('createdAt DESC')
            .limit(100)
        ).map((run) => run.summary)
      }
    if (operation === 'policy' && get)
      return {
        policy: policy || null,
        runners: await CiRunner.find({ app: appId })
          .select([
            'runnerId',
            'name',
            'policyRevision',
            'revokedAt',
            'createdAt'
          ])
          .limit(20)
      }
    if (get) throw new Error('Use the reviewed CI action to make changes.')
    if (operation === 'policy') {
      if (
        data.enabled === false &&
        policy &&
        data.approvePolicy === true &&
        data.policyRevision === policy.revision
      ) {
        const disabled = await CiPolicy.updateOne({
          id: policy.id,
          revision: policy.revision
        }).set({ enabled: false })
        if (!disabled)
          throw new Error('The CI policy changed; review it again.')
        return { policy: disabled }
      }
      if (data.approvePolicy !== true)
        throw new Error(
          'Review the commands, platform and local-device trust policy before saving.'
        )
      const source = await sails.helpers.ci.resolveSource.with({
        app: access.app,
        commit: data.commit,
        branch: data.branch
      })
      const execution = contract.configuration(
        source.manifest,
        data.image,
        data.platform
      )
      const configuration = {
        execution,
        configRevision: contract.digest(execution),
        localTrust: 'owner-approved-device',
        serverVerification: 'ci-server-verification-v1',
        maxReceiptAgeSeconds: 3600
      }
      const revision = contract.digest({
        appId: String(appId),
        repositoryId: source.repositoryId,
        branch: source.branch,
        configuration
      })
      const values = {
        revision,
        repositoryId: source.repositoryId,
        branch: source.branch,
        configuration,
        enabled: data.enabled === true,
        createdBy: access.user.id
      }
      if (policy)
        policy = await CiPolicy.updateOne({
          id: policy.id,
          revision: policy.revision
        }).set(values)
      else policy = await CiPolicy.create({ app: appId, ...values }).fetch()
      if (!policy)
        throw new Error('The policy changed. Reload and review it again.')
      return { policy }
    }
    if (operation === 'approve-runner') {
      if (!policy?.enabled)
        throw new Error('Enable a reviewed CI policy first.')
      if (
        data.trustDevice !== true ||
        data.policyRevision !== policy.revision ||
        typeof data.name !== 'string' ||
        !data.name.trim() ||
        data.name.length > 80 ||
        typeof data.publicKey !== 'string' ||
        data.publicKey.length > 256
      )
        throw new Error(
          'Explicit device trust and the current policy revision are required.'
        )
      let key
      try {
        key = crypto.createPublicKey(data.publicKey)
      } catch {
        throw new Error('Provide an Ed25519 public key, never a private key.')
      }
      if (
        key.asymmetricKeyType !== 'ed25519' ||
        data.publicKey.includes('PRIVATE')
      )
        throw new Error('Provide an Ed25519 public key, never a private key.')
      const runner = await CiRunner.getDatastore().transaction(
        async (connection) => {
          const locked = await CiPolicy.updateOne({
            id: policy.id,
            revision: policy.revision,
            enabled: true
          })
            .set({ revision: policy.revision })
            .usingConnection(connection)
          if (!locked) throw new Error('The policy changed. Review it again.')
          const publicKey = key.export({ type: 'spki', format: 'pem' })
          const [existing] = await CiRunner.find({
            app: appId,
            publicKey,
            revokedAt: null
          })
            .sort('createdAt DESC')
            .limit(1)
            .usingConnection(connection)
          if (existing)
            return CiRunner.updateOne({ id: existing.id })
              .set({
                name: data.name.trim(),
                policyRevision: policy.revision,
                approvedBy: access.user.id
              })
              .usingConnection(connection)
          if (
            (await CiRunner.count({
              app: appId,
              revokedAt: null
            }).usingConnection(connection)) >= 10
          )
            throw new Error(
              'Revoke an unused local runner before registering another.'
            )
          return CiRunner.create({
            runnerId: crypto.randomUUID(),
            app: appId,
            name: data.name.trim(),
            publicKey: key.export({ type: 'spki', format: 'pem' }),
            policyRevision: policy.revision,
            approvedBy: access.user.id
          })
            .fetch()
            .usingConnection(connection)
        }
      )
      return {
        runner: {
          runnerId: runner.runnerId,
          name: runner.name,
          policyRevision: runner.policyRevision
        }
      }
    }
    if (
      typeof data.runnerId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(data.runnerId)
    )
      throw new Error('Select an approved local runner.')
    const runner = await CiRunner.findOne({
      app: appId,
      runnerId: data.runnerId
    })
    if (!runner)
      throw new Error('That local runner is not approved for this app.')
    if (operation === 'revoke-runner') {
      await CiRunner.updateOne({ id: runner.id }).set({
        revokedAt: runner.revokedAt || Date.now()
      })
      return { revoked: true }
    }
    if (!policy?.enabled) throw new Error('Enable a reviewed CI policy first.')
    if (runner.revokedAt != null || runner.policyRevision !== policy.revision)
      throw new Error(
        'The runner is revoked or needs approval for the current policy.'
      )
    if (operation === 'challenge') {
      const source = await sails.helpers.ci.resolveSource.with({
        app: access.app,
        commit: data.commit,
        branch: policy.branch
      })
      if (
        source.repositoryId !== policy.repositoryId ||
        contract.digest(
          contract.configuration(
            source.manifest,
            policy.configuration.execution.runtime,
            policy.configuration.execution.platform
          )
        ) !== policy.configuration.configRevision
      )
        throw new Error(
          'Repository or check commands changed. Review a new policy.'
        )
      const challenge = await sails.helpers.ci.reserveChallenge.with({
        policy,
        runner,
        source
      })
      return { challenge, policy }
    }
    if (operation === 'receipt') {
      const run = await CiRun.findOne({
        app: appId,
        runner: runner.id,
        runId: data.runId
      })
      if (!run) throw new Error('A server-issued CI challenge is required.')
      const verified = await sails.helpers.ci.verifyLocalReceipt.with({
        challenge: run.challenge,
        runner,
        policy,
        report: data.report,
        signature: data.signature,
        now: Date.now()
      })
      if (run.state !== 'pending') {
        if (run.receiptHash !== verified.receiptHash)
          throw new Error(
            'This challenge already has a different terminal receipt.'
          )
        return { run: run.summary, reused: true }
      }
      return CiRun.getDatastore().transaction(async (connection) => {
        // Serialize trust changes and terminal admission on the same datastore.
        const locked = await CiPolicy.updateOne({
          id: policy.id,
          revision: policy.revision,
          enabled: true
        })
          .set({ revision: policy.revision })
          .usingConnection(connection)
        const current = await CiRunner.findOne({
          id: runner.id
        }).usingConnection(connection)
        if (
          !locked ||
          !current ||
          current.revokedAt != null ||
          current.policyRevision !== policy.revision
        )
          throw new Error('Runner trust or policy changed during submission.')
        const latest = await CiRun.findOne({ id: run.id }).usingConnection(
          connection
        )
        if (latest.state !== 'pending') {
          if (latest.receiptHash === verified.receiptHash)
            return { run: latest.summary, reused: true }
          throw new Error(
            'This challenge already has a different terminal receipt.'
          )
        }
        const accepted = await CiRun.updateOne({
          id: run.id,
          state: 'pending',
          expiresAt: { '>': Date.now() }
        })
          .set({
            state: verified.state,
            receiptHash: verified.receiptHash,
            summary: verified.summary,
            completedAt: Date.now()
          })
          .usingConnection(connection)
        if (!accepted)
          throw new Error('This challenge expired before submission.')
        return { run: accepted.summary, reused: false }
      })
    }
    throw new Error('Unsupported CI action.')
  }
}
