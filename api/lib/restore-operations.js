const transaction = require('./with-datastore-transaction')
let pumping = false
async function enqueue({ backup, service, teamId, userId }) {
  const operation = await transaction(async (db) => {
    if (
      (await RestoreOperation.count({
        status: { in: ['queued', 'running'] }
      }).usingConnection(db)) >= 20
    )
      throw new Error(
        'Restore queue is full. Retry after existing operations finish.'
      )
    const claimed = await Service.updateOne({
      id: service.id,
      status: 'running'
    })
      .set({ status: 'restoring' })
      .usingConnection(db)
    if (!claimed)
      throw new Error(
        'Another service operation is in progress. Wait before restoring.'
      )
    return RestoreOperation.create({
      backup: backup.id,
      service: service.id,
      team: teamId,
      requestedBy: userId
    })
      .usingConnection(db)
      .fetch()
  })
  wake()
  return operation
}
function wake() {
  setImmediate(() =>
    run().catch((error) =>
      sails.log.error(`Restore coordinator failed: ${error.message}`)
    )
  )
}
async function claim() {
  return transaction(async (db) => {
    if (
      (await RestoreOperation.count({ status: 'running' }).usingConnection(
        db
      )) >= 2
    )
      return null
    const [next] = await RestoreOperation.find({ status: 'queued' })
      .sort('id ASC')
      .limit(1)
      .usingConnection(db)
    return next
      ? RestoreOperation.updateOne({ id: next.id, status: 'queued' })
          .set({ status: 'running', startedAt: Date.now(), stage: 'snapshot' })
          .usingConnection(db)
      : null
  })
}
async function audit(operation, action, details = {}) {
  await sails.helpers.audit.log.with({
    action,
    resourceType: 'restore',
    resourceId: String(operation.id),
    userId: operation.requestedBy ? String(operation.requestedBy) : undefined,
    teamId: String(operation.team),
    details: {
      backupId: operation.backup,
      serviceId: operation.service,
      ...details
    }
  })
}
async function execute(operation) {
  let importing = false
  try {
    await audit(operation, 'restore.started')
    await sails.helpers.backup.restoreBackup.with({
      backupId: String(operation.backup),
      onProgress: async (stage, details = {}) => {
        if (stage === 'import') importing = true
        await RestoreOperation.updateOne({ id: operation.id }).set({
          stage,
          ...details
        })
      }
    })
    await transaction(async (db) => {
      await RestoreOperation.updateOne({ id: operation.id })
        .set({
          status: 'completed',
          stage: 'completed',
          completedAt: Date.now()
        })
        .usingConnection(db)
      await Service.updateOne({ id: operation.service, status: 'restoring' })
        .set({ status: 'running' })
        .usingConnection(db)
    })
    await audit(operation, 'restore.completed')
  } catch (error) {
    const message = `${error.message || error}${
      importing
        ? ' Import may be partial. Keep application writes paused and restore the safety snapshot after inspecting the service.'
        : ' Import did not start; the original database was preserved.'
    }`.slice(0, 2000)
    await transaction(async (db) => {
      await RestoreOperation.updateOne({ id: operation.id })
        .set({
          status: 'failed',
          error: message,
          completedAt: Date.now(),
          ...(error.snapshotId ? { snapshotId: error.snapshotId } : {})
        })
        .usingConnection(db)
      await Service.updateOne({ id: operation.service, status: 'restoring' })
        .set({ status: importing ? 'failed' : 'running' })
        .usingConnection(db)
    })
    await audit(operation, 'restore.failed', { error: message })
  } finally {
    wake()
  }
}
async function run() {
  if (pumping) return
  pumping = true
  try {
    let op
    while ((op = await claim()))
      execute(op).catch((error) =>
        sails.log.error(
          `Restore ${op.id} could not persist its result: ${error.message}`
        )
      )
  } finally {
    pumping = false
  }
}
async function recover() {
  await Service.update({ status: 'changing' }).set({ status: 'failed' })
  const interrupted = await RestoreOperation.find({ status: 'running' })
  for (const op of interrupted) {
    await transaction(async (db) => {
      await RestoreOperation.updateOne({ id: op.id })
        .set({
          status: 'interrupted',
          error:
            'Server stopped during restoration. Keep writes paused, inspect the database and safety snapshot, then start a deliberate recovery restore. This operation will not be replayed.',
          completedAt: Date.now()
        })
        .usingConnection(db)
      await Service.updateOne({ id: op.service, status: 'restoring' })
        .set({ status: 'failed' })
        .usingConnection(db)
    })
    await audit(op, 'restore.interrupted')
  }
  wake()
}
module.exports = { enqueue, recover, run }
