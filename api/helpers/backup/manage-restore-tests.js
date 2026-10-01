const { randomUUID } = require('node:crypto')
const transaction = require('../../lib/with-datastore-transaction')
let pumping = false
const controllers = new Map()

module.exports = {
  friendlyName: 'Manage restore tests',
  description:
    'Serialize isolated restore rehearsals and retain truthful reports across restarts.',
  inputs: {
    action: {
      type: 'string',
      isIn: ['enqueue', 'run', 'recover', 'cancel', 'cleanup'],
      required: true
    },
    backupId: { type: 'number' },
    serviceId: { type: 'number' },
    teamId: { type: 'number' },
    userId: { type: 'number' },
    testId: { type: 'number' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ action, backupId, serviceId, teamId, userId, testId }) {
    if (action === 'enqueue') {
      let backup = backupId ? await Backup.findOne({ id: backupId }) : null
      const service = await Service.findOne({
        id: backup?.service || serviceId
      })
      if (
        !service ||
        service.type !== 'postgresql' ||
        service.managementMode === 'external'
      )
        throw new Error(
          'Restore testing currently supports managed PostgreSQL databases.'
        )
      if (
        backup &&
        (backup.status !== 'completed' || !(backup.objectKey || backup.s3Key))
      )
        throw new Error('Choose a completed backup before testing restoration.')
      if (
        backup &&
        (!backup.sizeBytes ||
          backup.sizeBytes >
            sails.config.custom.databaseOperations.restoreTestMaxBytes)
      )
        throw new Error(
          'This backup exceeds the configured restore-test size limit, or has no recorded size. Create a new backup or use a separately provisioned recovery database.'
        )
      const environment = await Environment.findOne({ id: service.environment })
      const project =
        environment && (await Project.findOne({ id: environment.project }))
      if (project?.team !== teamId)
        throw new Error('Backup is not in this team.')
      const result = await transaction(async (db) => {
        const active = await RestoreTest.findOne({
          service: service.id,
          or: [
            { status: { in: ['queued', 'running'] } },
            { cleanupPending: true }
          ]
        }).usingConnection(db)
        if (active) {
          if (
            (!backupId || active.backup === backupId) &&
            !active.cleanupPending
          )
            return active
          throw new Error(
            'Another restore test or cleanup is pending for this database. Finish it first.'
          )
        }
        if (
          (await RestoreTest.count({
            status: { in: ['queued', 'running'] }
          }).usingConnection(db)) >= 20
        )
          throw new Error(
            'Restore test queue is full. Try again after a test finishes.'
          )
        if (
          await CleanupOperation.findOne({
            status: { nin: ['complete'] },
            or: [
              { scopeType: 'project', projectId: project.id },
              { scopeType: 'environment', environmentId: environment.id },
              { scopeType: 'service', serviceId: service.id }
            ]
          }).usingConnection(db)
        )
          throw new Error(
            'Service cleanup is in progress. Complete it before testing a backup.'
          )
        if (!backup) {
          if (service.status !== 'running')
            throw new Error('Start this database before creating a backup.')
          backup = await Backup.create({
            service: service.id,
            status: 'pending',
            type: 'manual',
            triggeredBy: userId
          })
            .usingConnection(db)
            .fetch()
        }
        return RestoreTest.create({
          backup: backup.id,
          service: service.id,
          team: teamId,
          requestedBy: userId,
          resourceName: `slipway-restore-test-${randomUUID()}`
        })
          .usingConnection(db)
          .fetch()
      })
      wake()
      return result
    }
    if (action === 'cancel') {
      const operation = await RestoreTest.findOne({ id: testId, team: teamId })
      if (!operation) throw new Error('Restore test not found.')
      const cancelled = await RestoreTest.updateOne({
        id: testId,
        status: 'queued'
      }).set({
        status: 'cancelled',
        stage: 'cancelled',
        completedAt: Date.now()
      })
      if (cancelled) {
        await Backup.updateOne({ id: cancelled.backup, status: 'pending' }).set(
          {
            status: 'failed',
            errorMessage:
              'Backup and restore test cancelled before backup started.',
            completedAt: Date.now()
          }
        )
        return cancelled
      }
      if (operation.status === 'running') {
        const controller = controllers.get(testId)
        if (!controller)
          throw new Error(
            'This test is recovering. Refresh its status before trying again.'
          )
        controller.abort()
      }
      return operation
    }
    if (action === 'cleanup') {
      const operation = await RestoreTest.updateOne({
        id: testId,
        team: teamId,
        cleanupPending: true,
        status: { nin: ['queued', 'running'] },
        stage: { '!=': 'cleanup' }
      }).set({ stage: 'cleanup' })
      if (!operation)
        throw new Error('Cleanup is already running or is not required.')
      try {
        await sails.helpers.backup.cleanupRestoreTest(operation)
        const cleaned = await RestoreTest.updateOne({ id: testId }).set({
          cleanupPending: false,
          stage: operation.status,
          report: { ...operation.report, cleanup: 'removed' }
        })
        wake()
        return cleaned
      } catch {
        await RestoreTest.updateOne({ id: testId }).set({
          stage: 'cleanup_pending'
        })
        throw new Error(
          'Temporary database cleanup failed. Check Docker access, then retry cleanup.'
        )
      }
    }
    if (action === 'recover') {
      const interrupted = await RestoreTest.find({ status: 'running' })
      for (const operation of interrupted) {
        await Backup.updateOne({
          id: operation.backup,
          status: { in: ['pending', 'running'] }
        }).set({
          status: 'failed',
          errorMessage:
            'Slipway restarted during backup creation. Create a new backup before testing recovery.',
          completedAt: Date.now()
        })
        await RestoreTest.updateOne({ id: operation.id }).set({
          status: 'interrupted',
          stage: 'interrupted',
          error:
            'Slipway restarted during this test. The result is unconfirmed; run a new test after cleanup.',
          cleanupPending: true,
          completedAt: Date.now()
        })
      }
      const pending = await RestoreTest.find({
        cleanupPending: true,
        status: { nin: ['queued', 'running'] }
      })
      for (const operation of pending) {
        try {
          await sails.helpers.backup.cleanupRestoreTest(operation)
          await RestoreTest.updateOne({ id: operation.id }).set({
            cleanupPending: false,
            stage: operation.status,
            report: { ...operation.report, cleanup: 'removed' }
          })
        } catch {
          await RestoreTest.updateOne({ id: operation.id }).set({
            stage: 'cleanup_pending'
          })
        }
      }
      wake()
      return
    }
    if (pumping) return
    pumping = true
    try {
      let operation
      while (
        (operation = await transaction(async (db) => {
          if (
            await RestoreTest.count({
              or: [{ status: 'running' }, { cleanupPending: true }]
            }).usingConnection(db)
          )
            return null
          const [next] = await RestoreTest.find({ status: 'queued' })
            .sort('id ASC')
            .limit(1)
            .usingConnection(db)
          return (
            next &&
            RestoreTest.updateOne({ id: next.id, status: 'queued' })
              .set({
                status: 'running',
                stage: 'preparing',
                startedAt: Date.now()
              })
              .usingConnection(db)
          )
        }))
      ) {
        const controller = new AbortController()
        controllers.set(operation.id, controller)
        try {
          await sails.helpers.backup.runRestoreTest.with({
            testId: operation.id,
            signal: controller.signal
          })
        } finally {
          controllers.delete(operation.id)
        }
      }
    } finally {
      pumping = false
      if (
        !(await RestoreTest.count({
          or: [{ status: 'running' }, { cleanupPending: true }]
        })) &&
        (await RestoreTest.count({ status: 'queued' }))
      )
        wake()
    }
  }
}
function wake() {
  const app = sails
  setImmediate(() =>
    app.helpers.backup.manageRestoreTests
      .with({ action: 'run' })
      .catch(() =>
        app.log.error(
          'Restore test coordinator stopped. Pending tests will resume after restart.'
        )
      )
  )
}
