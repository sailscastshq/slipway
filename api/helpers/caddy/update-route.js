const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Update route',

  description:
    'Replace an environment route through a verified caddy-docker-proxy label container.',

  inputs: {
    domainOverride: { type: 'ref' },
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment ID to update route for'
    },
    apps: {
      type: 'ref',
      description:
        'Optional complete app snapshot used to stage a route before committing App state.'
    },
    routeVersion: {
      type: 'string',
      description:
        'Unique deployment or operation identifier for the candidate route.'
    },
    deferCommit: {
      type: 'boolean',
      defaultsTo: false,
      description:
        'Keep the previous route active after candidate verification so the caller can commit or roll back the staged route.'
    }
  },

  exits: {
    success: {
      description: 'Route updated successfully',
      outputType: 'ref'
    },
    noApp: {
      description: 'No app deployed in this environment'
    }
  },

  fn: async function ({
    environmentId,
    apps,
    routeVersion,
    deferCommit,
    domainOverride
  }) {
    const environmentApps = Array.isArray(apps)
      ? apps
      : await App.find({ environment: environmentId })
    const previousApps = Array.isArray(apps)
      ? await App.find({ environment: environmentId })
      : environmentApps
    const config = await sails.helpers.caddy.generateRouteConfig.with({
      environmentId,
      apps: environmentApps,
      domainOverride
    })

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const network = sails.config.custom.slipwayNetwork || 'slipway'
    if (!config || !config.domains?.length || !config.route) {
      if (domainOverride) {
        const error = new Error(
          'Deploy a routed app before assigning a custom domain.'
        )
        error.code = 'DOMAIN_REQUIRES_DEPLOYMENT'
        throw error
      }
      const environment = await Environment.findOne({
        id: environmentId
      }).populate('project')
      if (!environment) throw 'noApp'
      const routeId = `slipway-route-${environment.project.slug}-${environment.slug}`
      const state = await getContainerState(dockerPath, routeId)
      const transaction = {
        claimOwner: `environment:${environmentId}`,
        removal: true,
        routeId,
        previousExists: state.exists,
        previousWasRunning: state.running,
        previousDomains: await Environment.getDomains(environmentId),
        candidateDomains: [],
        previousUpstreams: [],
        candidateUpstreams: []
      }
      if (!deferCommit)
        await sails.helpers.caddy.finishRouteUpdate.with({
          action: 'commit',
          transaction
        })
      return { domains: [], routeId, action: 'removed', transaction }
    }
    await require('../../lib/domain-claims').reserve(
      [
        ...new Set([
          ...config.domains,
          ...(await Environment.getDomains(environmentId))
        ])
      ],
      `environment:${environmentId}`
    )
    const routeContainerName = `slipway-route-${config.projectSlug}-${config.environmentSlug}`

    const routableApps = environmentApps.filter(
      (app) => app.hostPort && app.routePath !== null
    )
    const controlPlaneUpstream = `${
      sails.config.custom.slipwayContainerName || 'slipway'
    }:1337`
    const expectedUpstreams = routeUpstreams(routableApps, controlPlaneUpstream)
    const previousUpstreams = routeUpstreams(
      previousApps.filter((app) => app.hostPort && app.routePath !== null),
      controlPlaneUpstream
    )
    const suffix = normalizeContainerSuffix(routeVersion || String(Date.now()))
    const candidateName = `${routeContainerName}-candidate-${suffix}`
    const previousName = `${routeContainerName}-previous-${suffix}`
    const oldState = await getContainerState(dockerPath, routeContainerName)
    const oldExists = oldState.exists
    const oldWasRunning = oldState.running

    await tolerateDockerError(dockerPath, ['rm', '-f', candidateName])
    await tolerateDockerError(dockerPath, ['rm', '-f', previousName])

    const args = await buildCreateArgs({
      candidateName,
      network,
      config,
      routableApps
    })

    try {
      await execFileAsync(dockerPath, args)
      await execFileAsync(dockerPath, ['start', candidateName])

      // Keep the previous route active while Caddy accepts the candidate.
      // This lets the deployment commit App state before retiring anything.
      await sails.helpers.caddy.verifyRoute.with({
        expectedUpstreams,
        expectedDomains: config.domains
      })

      const transaction = {
        claimOwner: `environment:${environmentId}`,
        routeId: routeContainerName,
        candidateRouteId: candidateName,
        previousRouteId: previousName,
        previousExists: oldExists,
        previousWasRunning: oldWasRunning,
        previousUpstreams,
        candidateDomains: config.domains,
        previousDomains: await Environment.getDomains(environmentId),
        candidateUpstreams: expectedUpstreams
      }
      const result = {
        domain: config.domain,
        domains: config.domains,
        routeId: routeContainerName,
        action: oldExists ? 'replaced' : 'created',
        expectedUpstreams,
        transaction
      }

      if (deferCommit) {
        sails.log.info(
          `Caddy candidate route verified for ${config.domains.join(', ')}`
        )
        return result
      }

      await sails.helpers.caddy.finishRouteUpdate.with({
        action: 'commit',
        transaction
      })
      sails.log.info(`Caddy route verified for ${config.domains.join(', ')}`)
      return result
    } catch (error) {
      await tolerateDockerError(dockerPath, ['rm', '-f', candidateName])

      try {
        if (oldWasRunning && previousUpstreams.length > 0) {
          await sails.helpers.caddy.verifyRoute.with({
            expectedUpstreams: previousUpstreams,
            excludedUpstreams: expectedUpstreams.filter(
              (upstream) => !previousUpstreams.includes(upstream)
            )
          })
        }
      } catch (rollbackError) {
        error.rollbackError = rollbackError
      }

      if (!error.rollbackError)
        await require('../../lib/domain-claims').release(
          `environment:${environmentId}`,
          await Environment.getDomains(environmentId)
        )

      sails.log.error(
        `Caddy route replacement failed for ${config.domains.join(', ')}: ${
          error.message || error
        }`
      )
      throw error
    }
  }
}

async function buildCreateArgs({
  candidateName,
  network,
  config,
  routableApps
}) {
  const siteLabel = await sails.helpers.caddy.formatSiteLabel.with({
    domains: config.domains
  })
  const args = [
    'create',
    '--name',
    candidateName,
    '--network',
    network,
    '--restart',
    'unless-stopped',
    '--label',
    `caddy=${siteLabel}`
  ]
  const controlPlaneUpstream = `${
    sails.config.custom.slipwayContainerName || 'slipway'
  }:1337`
  const labels = buildRouteLabels({
    projectSlug: config.projectSlug,
    environmentSlug: config.environmentSlug,
    routableApps,
    controlPlaneUpstream
  })
  for (const label of labels) args.push('--label', label)

  const acmeEmail = await sails.helpers.setting.get('acmeEmail')
  if (acmeEmail && sails.config.custom.slipwayIngress !== 'cloudflare-tunnel') {
    args.push('--label', `caddy.tls=${acmeEmail}`)
  }

  args.push('alpine', 'sleep', 'infinity')
  return args
}

function buildRouteLabels({
  projectSlug,
  environmentSlug,
  routableApps,
  controlPlaneUpstream
}) {
  const labels = []
  let handleIndex = 0
  const sorted = [...routableApps].sort((a, b) => {
    if (a.routePath === '/') return 1
    if (b.routePath === '/') return -1
    return b.routePath.length - a.routePath.length
  })

  for (const app of sorted) {
    if (!app.bearingEnabled) continue

    const routePrefix = normalizeRoutePrefix(app.routePath)
    const bearingInternalPath = `${routePrefix}/_slipway/bearing`
    const publicBasePath = `${routePrefix}/bearing`
    const internalBasePath = `/_slipway/bearing/host/${projectSlug}/${environmentSlug}/${app.slug}`

    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${bearingInternalPath}/socket.io*`,
      uri: `strip_prefix ${bearingInternalPath}`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${bearingInternalPath}/identity`,
      ...(routePrefix ? { uri: `strip_prefix ${routePrefix}` } : {}),
      upstream: `${app.containerName}:${app.port}`
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${bearingInternalPath}/session`,
      uri: `replace ${bearingInternalPath}/session /bearing/session`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${bearingInternalPath}/_assets/*`,
      uri: `strip_prefix ${bearingInternalPath}/_assets`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${bearingInternalPath}/bootstrap.js`,
      uri: `replace ${bearingInternalPath}/bootstrap.js ${internalBasePath}/bootstrap.js`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${bearingInternalPath}/widget-config`,
      uri: `replace ${bearingInternalPath}/widget-config ${internalBasePath}/widget-config`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: publicBasePath,
      uri: `replace ${publicBasePath} ${internalBasePath}`,
      upstream: controlPlaneUpstream
    })
    for (const surface of ['feedback', 'roadmap', 'updates']) {
      const publicPath = `${publicBasePath}/${surface}`
      addHandle({
        labels,
        index: handleIndex++,
        matcher: `${publicPath}*`,
        uri: `replace ${publicPath} ${internalBasePath}/${surface}`,
        upstream: controlPlaneUpstream
      })
    }
  }

  for (const app of sorted) {
    if (!app.bridgeEnabled) continue

    const routePrefix = normalizeRoutePrefix(app.routePath)
    const publicBasePath = `${routePrefix}/bridge`
    const internalBasePath = `/projects/${projectSlug}/environments/${environmentSlug}/apps/${app.slug}/bridge`

    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${publicBasePath}/launch`,
      uri: `replace ${publicBasePath}/launch /bridge/launch`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${publicBasePath}/_assets/*`,
      uri: `strip_prefix ${publicBasePath}/_assets`,
      upstream: controlPlaneUpstream
    })
    addHandle({
      labels,
      index: handleIndex++,
      matcher: `${publicBasePath}*`,
      uri: `replace ${publicBasePath} ${internalBasePath}`,
      upstream: controlPlaneUpstream
    })
  }

  for (const app of sorted) {
    const routePrefix = normalizeRoutePrefix(app.routePath)
    addHandle({
      labels,
      index: handleIndex++,
      matcher: routePrefix ? `${routePrefix}*` : '/*',
      ...(routePrefix ? { uri: `strip_prefix ${routePrefix}` } : {}),
      upstream: `${app.containerName}:${app.port}`
    })
  }

  return labels
}

function addHandle({ labels, index, matcher, uri, upstream }) {
  const key = `caddy.handle_${index}`
  labels.push(`${key}=${matcher}`)
  if (uri) labels.push(`${key}.0_uri=${uri}`)
  labels.push(`${key}.1_reverse_proxy=${upstream}`)
}

function normalizeRoutePrefix(routePath) {
  if (!routePath || routePath === '/') return ''
  return `/${String(routePath).replace(/^\/+|\/+$/g, '')}`
}

function routeUpstreams(apps, controlPlaneUpstream) {
  const upstreams = apps.map((app) => `${app.containerName}:${app.port}`)
  if (apps.some((app) => app.bridgeEnabled || app.bearingEnabled)) {
    upstreams.push(controlPlaneUpstream)
  }
  return [...new Set(upstreams)]
}

async function getContainerState(dockerPath, containerName) {
  try {
    const { stdout } = await execFileAsync(dockerPath, [
      'inspect',
      '--format',
      '{{.State.Running}}',
      containerName
    ])
    return { exists: true, running: stdout.trim() === 'true' }
  } catch {
    return { exists: false, running: false }
  }
}

async function tolerateDockerError(dockerPath, args) {
  try {
    await execFileAsync(dockerPath, args)
  } catch {
    // Cleanup is intentionally idempotent.
  }
}

function normalizeContainerSuffix(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

module.exports._private = {
  buildCreateArgs,
  buildRouteLabels,
  normalizeContainerSuffix,
  routeUpstreams
}
