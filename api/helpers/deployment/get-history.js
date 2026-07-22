const ACTIVE_STATUSES = ['pending', 'building', 'pushing', 'deploying']
const SUCCESS_STATUSES = ['running', 'stopped']
const VALID_STATUS_FILTERS = [
  'all',
  'in-progress',
  'succeeded',
  'failed',
  'cancelled'
]
const VALID_SOURCES = ['manual', 'cli', 'webhook', 'api']

function encodeCursor(deployment) {
  return Buffer.from(
    JSON.stringify({ createdAt: deployment.createdAt, id: deployment.id })
  ).toString('base64url')
}

function decodeCursor(cursor) {
  if (!cursor) return null

  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    if (
      !Number.isFinite(parsed.createdAt) ||
      !Number.isFinite(Number(parsed.id))
    ) {
      return null
    }
    return { createdAt: parsed.createdAt, id: Number(parsed.id) }
  } catch {
    return null
  }
}

function outcomeFor(deployment, isCurrent) {
  if (isCurrent) return { key: 'current', label: 'Current' }

  const activeLabels = {
    pending: 'Queued',
    building: 'Building',
    pushing: 'Publishing',
    deploying: 'Deploying'
  }

  if (activeLabels[deployment.status]) {
    return { key: 'in-progress', label: activeLabels[deployment.status] }
  }
  if (SUCCESS_STATUSES.includes(deployment.status)) {
    return { key: 'succeeded', label: 'Succeeded' }
  }
  if (deployment.status === 'failed') {
    return { key: 'failed', label: 'Failed' }
  }
  if (deployment.status === 'cancelled') {
    return { key: 'cancelled', label: 'Cancelled' }
  }

  return { key: 'neutral', label: deployment.status }
}

function titleFor(deployment) {
  if (deployment.gitMessage) return deployment.gitMessage
  if (deployment.triggerType === 'webhook') return 'Git deployment'
  if (deployment.triggerType === 'cli') return 'Pushed source deployment'
  if (deployment.triggerType === 'api') return 'API deployment'
  return 'Manual deployment'
}

function sourceLabel(triggerType) {
  return {
    webhook: 'Git',
    cli: 'CLI',
    api: 'API',
    manual: 'Manual'
  }[triggerType]
}

function serializeDeployment({
  deployment,
  currentDeploymentIds,
  defaultAppByEnvironment,
  appById,
  environmentById,
  projectSlug
}) {
  const environmentId = Number(
    deployment.environment?.id || deployment.environment
  )
  const appId = Number(deployment.app?.id || deployment.app)
  const environment =
    (deployment.environment?.id && deployment.environment) ||
    environmentById.get(environmentId) ||
    null
  const app =
    (deployment.app?.id && deployment.app) ||
    appById.get(appId) ||
    defaultAppByEnvironment.get(environmentId) ||
    null
  const isCurrent = currentDeploymentIds.has(Number(deployment.id))
  const outcome = outcomeFor(deployment, isCurrent)
  const duration = Deployment.getDuration(deployment)

  return {
    id: deployment.id,
    title: titleFor(deployment),
    status: deployment.status,
    outcome: outcome.key,
    outcomeLabel: outcome.label,
    isCurrent,
    isActive: ACTIVE_STATUSES.includes(deployment.status),
    gitCommit: deployment.gitCommit,
    gitBranch: deployment.gitBranch,
    source: deployment.triggerType,
    sourceLabel: sourceLabel(deployment.triggerType) || 'System',
    actor:
      deployment.triggeredBy?.fullName ||
      (deployment.triggerType === 'webhook' ? 'Git' : 'System'),
    duration,
    createdAt: deployment.createdAt,
    deployedAt: deployment.finishedAt || deployment.createdAt,
    startedAt: deployment.startedAt,
    finishedAt: deployment.finishedAt,
    environment: environment
      ? { id: environment.id, name: environment.name, slug: environment.slug }
      : null,
    app: app ? { id: app.id, name: app.name, slug: app.slug } : null,
    href: `/projects/${projectSlug}/deployments/${deployment.id}`
  }
}

function normalizeFilters({ filters, environments, apps }) {
  const status = VALID_STATUS_FILTERS.includes(filters.status)
    ? filters.status
    : 'all'
  const environment = environments.find(
    (item) => item.slug === filters.environment
  )
  const app = apps.find((item) => String(item.id) === String(filters.app))
  const source = VALID_SOURCES.includes(filters.source) ? filters.source : ''

  return {
    status,
    environment: environment?.slug || '',
    app: app ? String(app.id) : '',
    source,
    environmentRecord: environment || null,
    appRecord: app || null
  }
}

function statusCriteria(status) {
  if (status === 'in-progress') return ACTIVE_STATUSES
  if (status === 'succeeded') return SUCCESS_STATUSES
  if (status === 'failed') return ['failed']
  if (status === 'cancelled') return ['cancelled']
  return null
}

function buildScopeClause({ environmentIds, scopedApp, includeLegacy }) {
  if (!scopedApp) return { environment: environmentIds }
  if (!includeLegacy) return { app: scopedApp.id }

  return {
    or: [
      { app: scopedApp.id },
      { app: null, environment: scopedApp.environment }
    ]
  }
}

module.exports = {
  friendlyName: 'Get deployment history',

  description:
    'Return current releases, active work, and a deterministic cursor page of deployment history.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environments: { type: 'ref', required: true },
    apps: { type: 'ref', required: true },
    currentApps: { type: 'ref', required: true },
    scopedApp: { type: 'ref' },
    includeLegacy: { type: 'boolean', defaultsTo: false },
    filters: { type: 'ref', required: true },
    cursor: { type: 'string', allowNull: true },
    limit: { type: 'number', defaultsTo: 25, max: 50 }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({
    projectSlug,
    environments,
    apps,
    currentApps,
    scopedApp,
    includeLegacy,
    filters,
    cursor,
    limit
  }) {
    const environmentIds = environments.map((item) => item.id)
    const normalized = normalizeFilters({ filters, environments, apps })
    const currentDeploymentIds = new Set(
      currentApps
        .map((app) => app.currentDeployment)
        .filter(Boolean)
        .map(Number)
        .filter((id) => Number.isFinite(id))
    )
    const environmentById = new Map(
      environments.map((item) => [Number(item.id), item])
    )
    const appById = new Map(apps.map((item) => [Number(item.id), item]))
    const defaultAppByEnvironment = new Map(
      apps
        .filter((item) => item.isDefault)
        .map((item) => [Number(item.environment), item])
    )
    const serialize = (deployment) =>
      serializeDeployment({
        deployment,
        currentDeploymentIds,
        defaultAppByEnvironment,
        appById,
        environmentById,
        projectSlug
      })

    if (environmentIds.length === 0) {
      return {
        currentReleases: [],
        activeDeployments: [],
        items: [],
        nextCursor: null,
        filters: {
          status: normalized.status,
          environment: '',
          app: '',
          source: ''
        },
        options: { environments: [], apps: [], sources: [] }
      }
    }

    const baseScope = buildScopeClause({
      environmentIds,
      scopedApp,
      includeLegacy
    })
    const historyClauses = [baseScope]
    const rawStatuses = statusCriteria(normalized.status)

    if (normalized.environmentRecord) {
      historyClauses.push({ environment: normalized.environmentRecord.id })
    }
    if (normalized.appRecord) {
      historyClauses.push(
        buildScopeClause({
          environmentIds,
          scopedApp: normalized.appRecord,
          includeLegacy: normalized.appRecord.isDefault
        })
      )
    }
    if (rawStatuses) historyClauses.push({ status: rawStatuses })
    if (normalized.source)
      historyClauses.push({ triggerType: normalized.source })

    const decodedCursor = decodeCursor(cursor)
    if (decodedCursor) {
      historyClauses.push({
        or: [
          { createdAt: { '<': decodedCursor.createdAt } },
          {
            createdAt: decodedCursor.createdAt,
            id: { '<': decodedCursor.id }
          }
        ]
      })
    }

    const historyRecords = await Deployment.find({ and: historyClauses })
      .sort(['createdAt DESC', 'id DESC'])
      .limit(limit + 1)

    const hasMore = historyRecords.length > limit
    const pageRecords = historyRecords.slice(0, limit)

    const activeRecords = await Deployment.find({
      and: [baseScope, { status: ACTIVE_STATUSES }]
    })
      .sort(['createdAt DESC', 'id DESC'])
      .limit(20)

    const currentIds = [...currentDeploymentIds]
    const currentRecords = currentIds.length
      ? await Deployment.find({ id: currentIds }).sort([
          'createdAt DESC',
          'id DESC'
        ])
      : []

    // Enrich after the ordered, limited query so adapter joins cannot alter
    // the ORDER BY direction or move LIMIT ahead of it.
    const actorIds = [
      ...new Set(
        [...pageRecords, ...activeRecords, ...currentRecords]
          .map((record) => record.triggeredBy)
          .filter(Boolean)
          .map(Number)
          .filter((id) => Number.isFinite(id))
      )
    ]
    const actors = actorIds.length ? await User.find({ id: actorIds }) : []
    const actorById = new Map(actors.map((actor) => [Number(actor.id), actor]))
    const withActor = (record) => ({
      ...record,
      triggeredBy: actorById.get(Number(record.triggeredBy)) || null
    })

    const currentAppByDeployment = new Map(
      currentApps
        .filter((app) => app.currentDeployment)
        .map((app) => [Number(app.currentDeployment), app])
    )
    const currentReleases = currentRecords.map((record) => {
      const serialized = serialize(withActor(record))
      const currentApp = currentAppByDeployment.get(Number(record.id))
      return {
        ...serialized,
        health:
          currentApp?.containerHealth === 'unhealthy'
            ? 'Unhealthy'
            : currentApp?.status === 'running'
            ? 'Healthy'
            : currentApp?.status
            ? currentApp.status[0].toUpperCase() + currentApp.status.slice(1)
            : 'Unknown',
        appHref:
          serialized.environment && serialized.app
            ? `/projects/${projectSlug}/environments/${serialized.environment.slug}/apps/${serialized.app.slug}`
            : null
      }
    })

    return {
      currentReleases,
      activeDeployments: activeRecords.map((record) =>
        serialize(withActor(record))
      ),
      items: pageRecords.map((record) => serialize(withActor(record))),
      nextCursor:
        hasMore && pageRecords.length
          ? encodeCursor(pageRecords[pageRecords.length - 1])
          : null,
      filters: {
        status: normalized.status,
        environment: normalized.environment,
        app: normalized.app,
        source: normalized.source
      },
      options: {
        environments: environments.map((item) => ({
          value: item.slug,
          label: item.name
        })),
        apps: apps.map((item) => {
          const environment = environmentById.get(Number(item.environment))
          const duplicateName = apps.some(
            (candidate) =>
              candidate.id !== item.id && candidate.name === item.name
          )
          return {
            value: String(item.id),
            label:
              duplicateName && environment
                ? `${environment.name} / ${item.name}`
                : item.name
          }
        }),
        sources: VALID_SOURCES.map((value) => ({
          value,
          label: sourceLabel(value)
        }))
      }
    }
  },

  _private: {
    ACTIVE_STATUSES,
    decodeCursor,
    encodeCursor,
    outcomeFor,
    serializeDeployment
  }
}
