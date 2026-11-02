const { test } = require('sounding')
const assert = require('node:assert/strict')
const Sqlite = require('better-sqlite3')
const transaction = require('../../../../api/lib/deployment-datastore-transaction')
const world = (slug) => ({
  name: 'configured-slipway',
  context: { deploymentTarget: { slug } }
})

test(
  'real WAL stale snapshot restarts a rolled-back deployment transaction with fresh state',
  { world: world('db-snapshot-recovery') },
  async ({ sails, world }) => {
    const row = await world
      .create('deployment')
      .with({ environment: world.current.environments.production.id })
    let attempts = 0
    let writer
    try {
      const result = await transaction(async (db) => {
        const before = await Deployment.findOne(row.id).usingConnection(db)
        if (++attempts === 1) {
          writer = new Sqlite(db.name)
          assert.equal(writer.pragma('journal_mode', { simple: true }), 'wal')
          writer
            .prepare('UPDATE deployments SET build_logs = ? WHERE id = ?')
            .run('concurrent progress', row.id)
        }
        return Deployment.updateOne(row.id)
          .set({ buildLogs: before.buildLogs + ':ours' })
          .usingConnection(db)
      })
      assert.equal(attempts, 2)
      assert.equal(result.buildLogs, 'concurrent progress:ours')
      assert.equal(
        (await Deployment.findOne(row.id)).buildLogs,
        'concurrent progress:ours'
      )
    } finally {
      writer?.close()
    }
  }
)

test(
  'real writer contention preserves adapter E_BUSY and retries only after rollback',
  { world: world('db-writer-recovery') },
  async ({ sails, world }) => {
    const row = await world
      .create('deployment')
      .with({ environment: world.current.environments.production.id })
    const db = sails.getDatastore().manager
    const timeout = db.pragma('busy_timeout', { simple: true })
    const writer = new Sqlite(db.name)
    let attempts = 0,
      waits = 0
    try {
      db.pragma('busy_timeout = 1') // this disposable test connection only
      writer.exec('BEGIN IMMEDIATE')
      await transaction(
        async (connection) => {
          attempts++
          try {
            return await Deployment.updateOne(row.id)
              .set({ status: 'building' })
              .usingConnection(connection)
          } catch (error) {
            assert.match(
              JSON.stringify({ code: error.code, raw: error.raw }),
              /E_BUSY|SQLITE_BUSY/
            )
            throw error
          }
        },
        {
          wait: async () => {
            waits++
            writer.exec('ROLLBACK')
          }
        }
      )
      assert.equal(attempts, 2)
      assert.equal(waits, 1)
      assert.equal((await Deployment.findOne(row.id)).status, 'building')
    } finally {
      if (writer.inTransaction) writer.exec('ROLLBACK')
      writer.close()
      db.pragma(`busy_timeout = ${timeout}`)
    }
  }
)

test(
  'lease expiry during retry rejects stale writes and rolls back progress',
  { world: world('db-expired-lease') },
  async ({ sails, world }) => {
    const queued = await sails.helpers.deploy.queueDeployment.with({
      values: {
        environment: world.current.environments.production.id,
        triggerType: 'manual'
      },
      app: world.current.apps.web,
      dispatch: false
    })
    const lease = await DeploymentLease.create({
      targetKey: queued.job.targetKey,
      deployment: queued.deployment.id,
      token: 'test-fenced-token',
      owner: 'disposable-test',
      stage: 'claimed',
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + 30000
    }).fetch()
    let attempts = 0
    const error = Object.assign(new Error('snapshot fixture'), {
      code: 'SQLITE_BUSY_SNAPSHOT'
    })
    await assert.rejects(
      transaction(
        async (db) => {
          attempts++
          await Deployment.updateOne(queued.deployment.id)
            .set({ status: 'building' })
            .usingConnection(db)
          throw error
        },
        {
          deploymentId: queued.deployment.id,
          leaseToken: lease.token,
          wait: async () => {
            await DeploymentLease.updateOne(lease.id).set({
              expiresAt: Date.now() - 1
            })
          }
        }
      ),
      { code: 'DEPLOYMENT_LEASE_LOST' }
    )
    assert.equal(attempts, 1)
    assert.equal(
      (await Deployment.findOne(queued.deployment.id)).status,
      'pending'
    )
  }
)

test(
  'concurrent claims admit exactly one pipeline attempt and one durable lease',
  { world: world('db-duplicate-admission') },
  async ({ sails, world }) => {
    const queued = await sails.helpers.deploy.queueDeployment.with({
      values: {
        environment: world.current.environments.production.id,
        triggerType: 'manual'
      },
      app: world.current.apps.web,
      dispatch: false
    })
    const claim =
      require('../../../../api/helpers/deploy/run-queued-deployments')._private
        .claimNextJob
    const results = await Promise.all([
      claim(queued.job.targetKey),
      claim(queued.job.targetKey)
    ])
    assert.equal(results.filter(Boolean).length, 1)
    assert.equal(
      await DeploymentLease.count({ deployment: queued.deployment.id }),
      1
    )
    assert.equal((await DeploymentJob.findOne(queued.job.id)).attempt, 1)
    assert.equal(await Deployment.count({ id: queued.deployment.id }), 1)
  }
)

test(
  'a lease expiring inside the database unit rolls back its update before commit',
  { world: world('db-precommit-fence') },
  async ({ sails, world }) => {
    const queued = await sails.helpers.deploy.queueDeployment.with({
      values: {
        environment: world.current.environments.production.id,
        triggerType: 'manual'
      },
      app: world.current.apps.web,
      dispatch: false
    })
    const lease = await DeploymentLease.create({
      targetKey: queued.job.targetKey,
      deployment: queued.deployment.id,
      token: 'precommit-fence',
      owner: 'disposable-test',
      stage: 'claimed',
      heartbeatAt: Date.now(),
      expiresAt: Date.now() + 30000
    }).fetch()
    await assert.rejects(
      transaction(
        async (db) => {
          await Deployment.updateOne(queued.deployment.id)
            .set({ status: 'building' })
            .usingConnection(db)
          await DeploymentLease.updateOne(lease.id)
            .set({ expiresAt: Date.now() - 1 })
            .usingConnection(db)
        },
        { deploymentId: queued.deployment.id, leaseToken: lease.token }
      ),
      { code: 'DEPLOYMENT_LEASE_LOST' }
    )
    assert.equal(
      (await Deployment.findOne(queued.deployment.id)).status,
      'pending'
    )
  }
)
