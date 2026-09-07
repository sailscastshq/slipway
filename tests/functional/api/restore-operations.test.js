const { test } = require('sounding')
const operations = require('../../../api/lib/restore-operations')

test(
  'restore operations serialize services and persist truthful outcomes and recovery',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'restore-operation' } }
    }
  },
  async ({ sails, world, expect }) => {
    const original = sails.helpers.backup.restoreBackup
    let release,
      entered = false
    const held = new Promise((resolve) => {
      release = resolve
    })
    let mode = 'complete'
    const fake = async ({ onProgress }) => {
      entered = true
      await held
      if (mode === 'snapshot') {
        const error = new Error('snapshot unavailable')
        error.snapshotId = 42
        throw error
      }
      await onProgress('download', { snapshotId: 42 })
      if (mode === 'download') throw new Error('download failed')
      await onProgress('import')
      if (mode === 'import') throw new Error('import failed')
      return { success: true }
    }
    fake.with = fake
    sails.helpers.backup.restoreBackup = fake
    try {
      const service = await world.create('service').with({
        environment: world.current.environments.production.id,
        status: 'running',
        name: 'restore-db'
      })
      const backup = await world.create('backup').with({
        service: service.id,
        status: 'completed',
        s3Key: 'fixture.dmp'
      })
      const args = {
        service,
        backup,
        teamId: world.current.teams.genesisTeam.id,
        userId: world.current.users.genesisUser.id
      }
      const results = await Promise.allSettled([
        operations.enqueue(args),
        operations.enqueue(args)
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled').length
      ).toBe(1)
      for (let i = 0; i < 100 && !entered; i++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      expect(
        (await sails.models.service.findOne({ id: service.id })).status
      ).toBe('restoring')
      const upgradeClaim = await sails.models.service
        .updateOne({ id: service.id, status: 'running' })
        .set({ status: 'upgrading' })
      expect(Boolean(upgradeClaim)).toBe(false)
      const first = results.find(
        (result) => result.status === 'fulfilled'
      ).value
      expect(
        await sails.models.auditlog.count({ action: 'backup.restored' })
      ).toBe(0)
      release()
      async function terminal(id) {
        for (let i = 0; i < 200; i++) {
          const op = await sails.models.restoreoperation.findOne({ id })
          if (!['queued', 'running'].includes(op.status)) return op
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error('restore did not settle')
      }
      expect((await terminal(first.id)).status).toBe('completed')
      for (const failure of ['snapshot', 'download', 'import']) {
        mode = failure
        const op = await operations.enqueue(args)
        const failed = await terminal(op.id)
        expect(failed.status).toBe('failed')
        expect(failed.snapshotId).toBe(42)
        expect(
          (await sails.models.service.findOne({ id: service.id })).status
        ).toBe(failure === 'import' ? 'failed' : 'running')
      }
      const interrupted = await sails.models.restoreoperation
        .create({
          ...{ backup: backup.id, service: service.id, team: args.teamId },
          status: 'running',
          stage: 'import',
          snapshotId: 42
        })
        .fetch()
      await sails.models.service
        .updateOne({ id: service.id })
        .set({ status: 'restoring' })
      await operations.recover()
      expect((await terminal(interrupted.id)).status).toBe('interrupted')
      expect(
        (await sails.models.service.findOne({ id: service.id })).status
      ).toBe('failed')
    } finally {
      release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      sails.helpers.backup.restoreBackup = original
    }
  }
)
