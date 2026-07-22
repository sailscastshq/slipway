module.exports = {
  friendlyName: 'Cut over traffic',

  description:
    'Verify a candidate Caddy route before committing App state, with deterministic route restoration on failure.',

  inputs: {
    deploymentId: {
      type: 'string',
      required: true,
      description: 'Deployment that owns this cutover.'
    },
    environmentId: {
      type: 'string',
      required: true,
      description: 'Environment whose route is being changed.'
    },
    appId: {
      type: 'string',
      description: 'Existing App record to replace.'
    },
    candidate: {
      type: 'ref',
      required: true,
      description: 'Candidate App fields after health checks have passed.'
    }
  },

  exits: {
    success: {
      description: 'Traffic and App state now point at the candidate.',
      outputType: 'ref'
    }
  },

  fn: async function ({ deploymentId, environmentId, appId, candidate }) {
    const previousApp = appId ? await App.findOne({ id: appId }) : null
    if (appId && !previousApp) {
      throw new Error(`Cannot cut over missing app ${appId}.`)
    }

    const currentApps = await App.find({ environment: environmentId })
    const candidateApp = {
      ...(previousApp || {}),
      ...candidate,
      id: previousApp?.id,
      environment: environmentId,
      status: 'running',
      imageId: null,
      lastDeployedAt: Date.now(),
      currentDeployment: deploymentId,
      slug: candidate.slug || previousApp?.slug || 'app',
      name:
        candidate.name ||
        previousApp?.name ||
        candidate.slug ||
        previousApp?.slug ||
        'app',
      healthPath: App.normalizeHealthPath(
        candidate.healthPath || previousApp?.healthPath
      ),
      routePath:
        candidate.routePath === undefined
          ? previousApp?.routePath ?? '/'
          : candidate.routePath,
      isDefault:
        candidate.isDefault === undefined
          ? previousApp?.isDefault ?? true
          : candidate.isDefault
    }
    const routeApps = previousApp
      ? currentApps.map((app) =>
          app.id === previousApp.id ? candidateApp : app
        )
      : [...currentApps, candidateApp]
    const auditContext = await getAuditContext(deploymentId, environmentId)
    const requiresRouteCutover = candidateApp.routePath !== null
    let candidateRouteApplied = false
    let stagedRoute = null
    let appStateCommitted = false
    let committedApp = null

    await appendDeployLog(
      deploymentId,
      `Cutover: applying route to ${candidateApp.containerName}:${candidateApp.port}\n`
    )
    await audit('deployment.cutover.started', {
      ...auditContext,
      deploymentId,
      environmentId,
      fromContainer: previousApp?.containerName || null,
      toContainer: candidateApp.containerName
    })

    try {
      const route = requiresRouteCutover
        ? await sails.helpers.caddy.updateRoute.with({
            environmentId,
            apps: routeApps,
            routeVersion: deploymentId,
            deferCommit: true
          })
        : { action: 'unchanged', reason: 'worker' }
      candidateRouteApplied = requiresRouteCutover
      stagedRoute = route.transaction || null

      committedApp = previousApp
        ? await App.updateOne({ id: previousApp.id }).set(
            appValues(candidateApp)
          )
        : await App.create(appValues(candidateApp)).fetch()

      if (!committedApp) {
        throw new Error(
          'The candidate route loaded, but App state was not updated.'
        )
      }
      appStateCommitted = true

      if (stagedRoute) {
        await sails.helpers.caddy.finishRouteUpdate.with({
          action: 'commit',
          transaction: stagedRoute
        })
      }

      await appendDeployLog(
        deploymentId,
        `Cutover: route verified and App state committed.\n`
      )
      await audit('deployment.cutover.succeeded', {
        ...auditContext,
        deploymentId,
        environmentId,
        fromContainer: previousApp?.containerName || null,
        toContainer: candidateApp.containerName
      })

      return { app: committedApp, previousApp, route }
    } catch (cutoverError) {
      // A staged route can be retried here even if the lower-level commit's
      // first restoration attempt failed. Only report rollback failure when
      // this final recovery attempt also fails.
      let rollbackError = stagedRoute
        ? null
        : cutoverError.rollbackError || null

      if (stagedRoute) {
        try {
          await sails.helpers.caddy.finishRouteUpdate.with({
            action: 'rollback',
            transaction: stagedRoute
          })
        } catch (error) {
          rollbackError = combineErrors(
            rollbackError,
            error.rollbackError || error
          )
        }
      } else if (candidateRouteApplied) {
        try {
          await sails.helpers.caddy.updateRoute.with({
            environmentId,
            routeVersion: `${deploymentId}-rollback`
          })
        } catch (error) {
          rollbackError = combineErrors(
            rollbackError,
            error.rollbackError || error
          )
        }
      }

      if (appStateCommitted) {
        try {
          if (previousApp) {
            await App.updateOne({ id: previousApp.id }).set(
              appValues(previousApp)
            )
          } else if (committedApp) {
            await App.destroyOne({ id: committedApp.id })
          }
        } catch (error) {
          rollbackError = combineErrors(rollbackError, error)
        }
      }

      await appendDeployLog(
        deploymentId,
        `Cutover failed: ${cutoverError.message || cutoverError}\n`
      )
      await audit('deployment.cutover.failed', {
        ...auditContext,
        deploymentId,
        environmentId,
        fromContainer: previousApp?.containerName || null,
        toContainer: candidateApp.containerName,
        error: cutoverError.message || String(cutoverError)
      })

      if (rollbackError) {
        await appendDeployLog(
          deploymentId,
          `Cutover rollback failed: ${rollbackError.message || rollbackError}\n`
        )
        await audit('deployment.cutover.rollback_failed', {
          ...auditContext,
          deploymentId,
          environmentId,
          restoredContainer: previousApp?.containerName || null,
          error: rollbackError.message || String(rollbackError)
        })

        const error = new Error(
          `Traffic cutover failed: ${
            cutoverError.message || cutoverError
          }. Cutover rollback also failed: ${
            rollbackError.message || rollbackError
          }`,
          { cause: cutoverError }
        )
        error.code = 'TRAFFIC_CUTOVER_ROLLBACK_FAILED'
        error.rollbackError = rollbackError
        throw error
      }

      await appendDeployLog(
        deploymentId,
        previousApp
          ? `Cutover rolled back; the previous route and container remain active.\n`
          : `Cutover rolled back; the candidate route was removed and no partial App state remains.\n`
      )
      await audit('deployment.cutover.rolled_back', {
        ...auditContext,
        deploymentId,
        environmentId,
        restoredContainer: previousApp?.containerName || null
      })

      const error = new Error(
        `Traffic cutover failed and was rolled back: ${
          cutoverError.message || cutoverError
        }`,
        { cause: cutoverError }
      )
      error.code = cutoverError.code || 'TRAFFIC_CUTOVER_FAILED'
      throw error
    }
  }
}

function appValues(app) {
  return {
    status: 'running',
    containerId: app.containerId,
    containerName: app.containerName,
    imageId: app.imageId ?? null,
    imageName: app.imageName,
    port: app.port,
    hostPort: app.hostPort,
    lastDeployedAt: app.lastDeployedAt,
    environment: app.environment,
    currentDeployment: app.currentDeployment,
    slug: app.slug || 'app',
    name: app.name || app.slug || 'app',
    healthPath: app.healthPath,
    routePath: app.routePath === undefined ? '/' : app.routePath,
    isDefault: app.isDefault === undefined ? true : app.isDefault
  }
}

function combineErrors(first, second) {
  if (!first) return second
  if (!second) return first
  return new Error(`${first.message || first}; ${second.message || second}`, {
    cause: first
  })
}

async function appendDeployLog(deploymentId, message) {
  try {
    await Deployment.appendDeployLog(deploymentId, message)
  } catch {
    // The cutover result must not depend on best-effort logging.
  }
}

async function getAuditContext(deploymentId, environmentId) {
  const [deployment, environment] = await Promise.all([
    Deployment.findOne({ id: deploymentId }),
    Environment.findOne({ id: environmentId }).populate('project')
  ])

  return {
    userId:
      typeof deployment?.triggeredBy === 'object'
        ? deployment.triggeredBy.id
        : deployment?.triggeredBy,
    teamId:
      typeof environment?.project?.team === 'object'
        ? environment.project.team.id
        : environment?.project?.team
  }
}

async function audit(action, details) {
  await sails.helpers.audit.log.with({
    action,
    resourceType: 'deployment',
    resourceId: details.deploymentId,
    details: {
      environmentId: details.environmentId,
      fromContainer: details.fromContainer,
      toContainer: details.toContainer,
      restoredContainer: details.restoredContainer,
      error: details.error
    },
    userId: details.userId,
    teamId: details.teamId
  })
}

module.exports._private = { appValues, combineErrors }
