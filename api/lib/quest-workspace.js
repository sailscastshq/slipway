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
  const { app } = await require('./app-selection')(req, environment.id)
  return { user, project, environment, app }
}

async function synchronizeRun(
  context,
  run,
  { observedBefore = Date.now() } = {}
) {
  const scope = {
    appId: String(context.app.id),
    environmentId: String(context.environment.id)
  }
  if (String(run.deploymentId) !== String(context.app.currentDeployment))
    throw Object.assign(new Error('Quest resident deployment changed.'), {
      code: 'QUEST_RUN_CONFLICT'
    })
  await ledger.admitReceipt(run, scope)
  if (run.state === 'running')
    await ledger.restoreResidentRunning(run, scope, { observedBefore })
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

function snapshotIdentity({ app, environment }) {
  const key = `${app?.id}:${environment.id}`
  // Keep one entry per scoped app. Returning to running must not revive a
  // prior running snapshot after a stopped/unavailable observation.
  const authority = JSON.stringify([
    String(app?.currentDeployment || ''),
    app?.containerName || null,
    app?.status || null,
    !!environment.features?.['sails-quest']
  ])
  return { key, authority }
}

async function snapshot(context, { fresh = false } = {}) {
  const { key, authority } = snapshotIdentity(context)
  const old = snapshots.get(key)
  if (
    old?.authority === authority &&
    (old.pending || (!fresh && Date.now() - old.at < CACHE_MS))
  )
    return forViewer(await old.promise, context.user)
  const promise = buildSnapshot(context)
  const entry = { authority, at: Date.now(), pending: true, promise }
  snapshots.set(key, entry)
  try {
    entry.value = await promise
    return forViewer(entry.value, context.user)
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
  const inspectionStartedAt = Date.now()
  const { app, environment } = context
  const scope = app
    ? { appId: String(app.id), environmentId: String(environment.id) }
    : null
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
    runtimeState: 'unknown',
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
    const history = await ledger.listRuns(scope, {})
    Object.assign(base, history)
  }
  if (!inspect && feature && app?.status === 'running' && app.containerName) {
    base.runtimeState = 'loading'
    base.reason = null
    return base
  }
  if (!inspect) return base
  const unavailable = async (reason) => {
    if (scope) {
      base.runtimeReconciliation = await ledger.reconcileUnavailableRuns(
        scope,
        {
          reason,
          before: inspectionStartedAt
        }
      )
      Object.assign(base, await ledger.listRuns(scope, {}))
    }
    return base
  }
  if (!feature || !app || app.status !== 'running' || !app.containerName) {
    base.runtimeState = app?.status === 'stopped' ? 'stopped' : 'unreachable'
    base.reason =
      app?.status === 'stopped'
        ? 'The app is stopped.'
        : 'The resident Quest runtime is unavailable.'
    return unavailable(
      app?.status === 'stopped' ? 'app_stopped' : 'resident_unavailable'
    )
  }
  let live
  try {
    live = await runtime.request(app, 'snapshot')
    if (
      live.version !== 1 ||
      typeof live.runtimeId !== 'string' ||
      !live.runtimeId ||
      !Array.isArray(live.jobs) ||
      !Array.isArray(live.runs) ||
      live.runs.length > 32 ||
      live.runs.some(
        (run) =>
          typeof run.runId !== 'string' ||
          !run.runId ||
          run.runtimeId !== live.runtimeId ||
          String(run.deploymentId) !== String(app.currentDeployment)
      )
    )
      throw new Error('Unsupported Quest runtime contract.')
  } catch (error) {
    // Transport or contract failure proves only that current evidence could
    // not be read. It never proves child exit, cancellation, or app shutdown.
    base.runtimeState = live || error.code ? 'unknown' : 'unreachable'
    base.reason =
      base.runtimeState === 'unknown'
        ? 'The runtime response could not establish current job state. Refresh to check again.'
        : 'The resident Quest runtime could not be reached. Current job state is unknown.'
    return unavailable('resident_unavailable')
  }
  try {
    base.mode = 'resident'
    base.runtimeState = 'live'
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
      scope,
      live.runtimeId,
      { observedBefore: inspectionStartedAt }
    )
    base.evidenceReconciliation = await ledger.reconcileUnavailableRuns(scope, {
      reason: 'receipt_not_retained',
      runtimeId: live.runtimeId,
      deploymentId: String(app.currentDeployment),
      retainedRunIds: live.runs.map((run) => run.runId),
      before: inspectionStartedAt
    })
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
        (residentReceipts.has(receiptKey(context, summary)) &&
          retained?.state !== 'unconfirmed')
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
        await synchronizeRun(context, detail.run, {
          observedBefore: inspectionStartedAt
        })
      })
    )
    Object.assign(base, await ledger.listRuns(scope, {}))
  } catch {
    // A failed payload/ledger reconciliation does not invalidate a successfully
    // observed runtime snapshot or fabricate a new process outcome.
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
  initialSnapshot: async (context) => {
    const { key, authority } = snapshotIdentity(context)
    const cached = snapshots.get(key)
    const age = Date.now() - cached?.value?.observedAt
    // Reuse only completed, recent evidence for this deployment/container/state.
    // A first visitor or an in-flight probe never waits on container transport.
    if (
      cached?.authority === authority &&
      !cached.pending &&
      cached.value?.mode === 'resident' &&
      age >= 0 &&
      age < CACHE_MS &&
      Date.now() - cached.at < CACHE_MS
    )
      return forViewer(cached.value, context.user)
    return forViewer(await buildSnapshot(context, false), context.user)
  }
}
