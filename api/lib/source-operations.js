const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const transaction = require('./with-datastore-transaction')
const workspace = require('./source-workspace')
let pumping = false
const controllers = new Map()
function publicOperation(op) {
  return {
    id: op.id,
    projectId: op.project?.id || op.project,
    status: op.status,
    sourceRevision: op.sourceRevision,
    error: op.error,
    cancelRequested: op.cancelRequested
  }
}
async function enqueue({ project, userId, archive }) {
  const dir = path.join(sails.config.custom.slipwayAppsDir, '.source-uploads')
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  const stored = path.join(dir, `${randomUUID()}.tgz`)
  try {
    await fs.copyFile(archive, stored)
    const operation = await transaction(async (db) => {
      await SourceOperation.destroy({
        status: { in: ['completed', 'failed', 'cancelled'] },
        updatedAt: { '<': Date.now() - 7 * 86400000 }
      }).usingConnection(db)
      if (
        (await SourceOperation.count({
          status: { in: ['queued', 'running'] }
        }).usingConnection(db)) >= 20 ||
        (await SourceOperation.count({
          project: project.id,
          status: { in: ['queued', 'running'] }
        }).usingConnection(db)) >= 2
      ) {
        const error = new Error(
          'Source queue is full. Wait for existing uploads to finish.'
        )
        error.code = 'SOURCE_BUSY'
        throw error
      }
      return SourceOperation.create({
        project: project.id,
        requestedBy: userId,
        archivePath: stored
      })
        .usingConnection(db)
        .fetch()
    })
    wake()
    return operation
  } catch (error) {
    await fs.rm(stored, { force: true })
    throw error
  }
}
function wake() {
  setImmediate(() =>
    run().catch((error) =>
      sails.log.error(`Source worker failed: ${error.message}`)
    )
  )
}
async function claim() {
  return transaction(async (db) => {
    const running = await SourceOperation.find({
      status: 'running'
    }).usingConnection(db)
    if (running.length >= 2) return null
    const busyProjects = new Set(running.map((op) => op.project))
    const queued = await SourceOperation.find({ status: 'queued' })
      .sort('id ASC')
      .usingConnection(db)
    const next = queued.find((op) => !busyProjects.has(op.project))
    return next
      ? SourceOperation.updateOne({ id: next.id, status: 'queued' })
          .set({ status: 'running' })
          .usingConnection(db)
      : null
  })
}
async function execute(operation) {
  const controller = new AbortController()
  controllers.set(operation.id, controller)
  const cancellation = setInterval(async () => {
    try {
      const live = await SourceOperation.findOne({ id: operation.id })
      if (live?.cancelRequested)
        controller.abort(new Error('Source upload cancelled'))
    } catch (error) {
      sails.log.warn(`Source cancellation check failed: ${error.message}`)
    }
  }, 500)
  cancellation.unref()
  try {
    const project = await Project.findOne({ id: operation.project })
    if (!project) throw new Error('Project no longer exists')
    const live = await SourceOperation.findOne({ id: operation.id })
    if (live.cancelRequested)
      controller.abort(new Error('Source upload cancelled'))
    const result = await workspace.publishArchive({
      root: sails.config.custom.slipwayAppsDir,
      project,
      archive: operation.archivePath,
      limits: sails.config.custom.sourceArchiveLimits,
      signal: controller.signal
    })
    await SourceOperation.updateOne({ id: operation.id }).set({
      status: 'completed',
      sourceRevision: result.revision
    })
    try {
      const features = await sails.helpers.sails.detectFeatures(result.target)
      await Environment.update({ project: project.id }).set({ features })
    } catch (error) {
      sails.log.warn(`Feature detection failed: ${error.message}`)
    }
  } catch (error) {
    await SourceOperation.updateOne({ id: operation.id }).set({
      status: controller.signal.aborted ? 'cancelled' : 'failed',
      error: String(error.message || error).slice(0, 1000)
    })
  } finally {
    clearInterval(cancellation)
    controllers.delete(operation.id)
    await fs.rm(operation.archivePath, { force: true })
    wake()
  }
}
async function run() {
  if (pumping) return
  pumping = true
  try {
    let operation
    while ((operation = await claim())) {
      const claimedId = operation.id
      execute(operation).catch((error) =>
        sails.log.error(
          `Source operation ${claimedId} failed: ${error.message}`
        )
      )
    }
  } finally {
    pumping = false
  }
}
async function recover() {
  // The web server is the single coordinator. Console jobs must not call this.
  const interrupted = await SourceOperation.update({ status: 'running' })
    .set({
      status: 'failed',
      error:
        'Server stopped during source publication. Inspect the project source lock and retained workspace before retrying.'
    })
    .fetch()
  for (const op of interrupted) await fs.rm(op.archivePath, { force: true })
  wake()
}
async function cancel(id) {
  const operation = await SourceOperation.findOne({ id })
  if (!operation || !['queued', 'running'].includes(operation.status))
    return operation
  const queued = await SourceOperation.updateOne({ id, status: 'queued' }).set({
    status: 'cancelled',
    cancelRequested: true
  })
  if (queued) {
    await fs.rm(queued.archivePath, { force: true })
    return queued
  }
  const running = await SourceOperation.updateOne({
    id,
    status: 'running'
  }).set({ cancelRequested: true })
  controllers.get(Number(id))?.abort(new Error('Source upload cancelled'))
  return running || SourceOperation.findOne({ id })
}
module.exports = { enqueue, run, recover, cancel, publicOperation }
