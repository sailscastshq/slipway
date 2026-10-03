const runtime = require('./quest-runtime-client')
const ledger = require('./quest-run-ledger')
const snapshots = new Map()
// Up to 32 resident receipts per each of 128 cached targets. This is only a
// bounded read optimization: restart/eviction safely repeats evidence reads,
// never job execution, and failed reads are not remembered.
const residentReceipts = new Map()
const MAX_RECONCILED_RECEIPTS = 4096
const CACHE_MS = 5000
const noCapabilities = Object.freeze({
  invoke: false,
  pause: false,
  resume: false,
  cancel: false,
  results: false,
  typedInputs: false
})

async function resolveContext(
  req,
  projectSlug,
  environmentSlug = 'production',
  mutate = false
) {
  const user = await User.forRequest(req)
  if (!user) throw 'notFound'
  if (
    mutate &&
    (!['owner', 'admin'].includes(user.teamRole) ||
      req.bridgeSupport ||
      req.supportContext ||
      req.isReadOnly)
  )
    throw 'forbidden'
  const project = await Project.findOne({
    slug: projectSlug,
    team: typeof user.team === 'object' ? user.team.id : user.team
  })
  if (!project) throw 'notFound'
  const environment = await Environment.findOne({
    slug: environmentSlug,
    project: project.id
  })
  if (!environment) throw 'notFound'
  const app =
    (await App.findOne({ environment: environment.id, isDefault: true })) ||
    (await App.findOne({ environment: environment.id }))
  return { user, project, environment, app }
}

async function synchronizeRun(context, run) {
  const scope = {
    appId: String(context.app.id),
    environmentId: String(context.environment.id)
  }
  if (String(run.deploymentId) !== String(context.app.currentDeployment))
    throw Object.assign(new Error('Quest resident deployment changed.'), {
      code: 'QUEST_RUN_CONFLICT'
    })
  await ledger.admitReceipt(run, scope)
  await ledger.ingest(run, scope)
  const retained = await ledger.enrichResidentReceipt(run, scope)
  if (retained) {
    const key = receiptKey(context, run)
    residentReceipts.delete(key)
    residentReceipts.set(key, true)
    if (residentReceipts.size > MAX_RECONCILED_RECEIPTS)
      residentReceipts.delete(residentReceipts.keys().next().value)
  }
  return retained
}

function receiptKey(context, run) {
  return JSON.stringify([
    String(context.app.id),
    String(context.environment.id),
    String(context.app.currentDeployment),
    run.runtimeId,
    run.runId,
    run.sequence
  ])
}

async function snapshot(context, { fresh = false } = {}) {
  const { app, environment } = context
  const key = `${app?.id}:${app?.currentDeployment}:${app?.containerName}`
  const old = snapshots.get(key)
  if (old && (old.pending || (!fresh && Date.now() - old.at < CACHE_MS)))
    return forViewer(await old.promise, context.user)
  const promise = buildSnapshot(context)
  const entry = { at: Date.now(), pending: true, promise }
  snapshots.set(key, entry)
  try {
    return forViewer(await promise, context.user)
  } finally {
    entry.pending = false
    if (snapshots.size > 128) snapshots.delete(snapshots.keys().next().value)
  }
}

function forViewer(workspace, user) {
  if (['owner', 'admin'].includes(user?.teamRole)) return workspace
  return {
    ...workspace,
    capabilities: {
      ...workspace.capabilities,
      invoke: false,
      pause: false,
      resume: false,
      cancel: false
    }
  }
}

async function buildSnapshot(context, inspect = true) {
  const { app, environment } = context
  const feature = environment.features?.['sails-quest']
  const target = {
    appId: app?.id || null,
    appName: app?.name || app?.slug || 'App',
    environmentId: environment.id,
    environmentName: environment.name || environment.slug,
    deploymentId: app?.currentDeployment || null,
    runtimeId: null
  }
  const base = {
    version: 1,
    mode: feature ? 'legacy' : 'unavailable',
    observedAt: null,
    target,
    capabilities: { ...noCapabilities },
    jobs: (feature?.scripts || []).map((script) => ({
      name: script.name,
      friendlyName: script.name,
      description: '',
      script: `scripts/${script.name}.js`,
      schedule: null,
      scheduleType: 'unavailable',
      paused: null,
      isRunning: null,
      inputs: [],
      validationErrors: []
    })),
    runs: [],
    legacyEvents: [],
    nextCursor: null,
    historyScope: 'Last 7 days',
    reason:
      'Upgrade and enable the resident Quest runtime to inspect schedules and run jobs.'
  }
  if (app) {
    const history = await ledger.listRuns(
      { appId: String(app.id), environmentId: String(environment.id) },
      {}
    )
    Object.assign(base, history)
  }
  if (!inspect) return base
  if (!feature || !app || app.status !== 'running' || !app.containerName) {
    base.reason = 'The app is not running.'
    return base
  }
  try {
    const live = await runtime.request(app, 'snapshot')
    if (live.version !== 1 || !live.runtimeId || !Array.isArray(live.jobs))
      throw new Error('Unsupported Quest runtime contract.')
    base.mode = 'resident'
    base.observedAt = live.observedAt
    base.target.runtimeId = live.runtimeId
    base.jobs = live.jobs
    base.capabilities = {
      ...noCapabilities,
      ...live.capabilities,
      cancel: false
    }
    base.reason = null
    base.runtimeReconciliation = await ledger.reconcileRuntimeLoss(
      { appId: app.id, environmentId: environment.id },
      live.runtimeId
    )
    // One shared bounded reconciliation for all viewers. Only fetch payloads
    // whose sequence advanced; summaries never include log/result bodies.
    const pending = []
    for (const summary of (live.runs || []).slice(-32).reverse()) {
      const retained = await ledger
        .getReceiptMeta(
          { appId: String(app.id), environmentId: String(environment.id) },
          summary.runId
        )
        .catch(() => null)
      if (
        retained?.sequence > summary.sequence ||
        residentReceipts.has(receiptKey(context, summary))
      )
        continue
      pending.push(summary)
      if (pending.length === 4) break
    }
    await Promise.all(
      pending.map(async (summary) => {
        const detail = await runtime.request(app, 'run', {
          runtimeId: live.runtimeId,
          runId: summary.runId
        })
        await synchronizeRun(context, detail.run)
      })
    )
    Object.assign(
      base,
      await ledger.listRuns(
        { appId: String(app.id), environmentId: String(environment.id) },
        {}
      )
    )
  } catch {
    // Legacy/source detection is not resident state. No temporary Sails lift.
  }
  return base
}
function invalidate(app) {
  for (const key of snapshots.keys())
    if (key.startsWith(`${app.id}:`)) snapshots.delete(key)
}
module.exports = {
  resolveContext,
  snapshot,
  synchronizeRun,
  invalidate,
  noCapabilities,
  initialSnapshot: async (context) =>
    forViewer(await buildSnapshot(context, false), context.user)
}
