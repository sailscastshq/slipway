const recovery = require('../../lib/deployment-recovery')
const transaction = require('../../lib/with-datastore-transaction')
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
    leaseToken: {
      type: 'string',
      description: 'Fencing token held by the durable deployment worker.'
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
    ciApproval: { type: 'ref' },
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

  fn: async function ({
    deploymentId,
    leaseToken,
    environmentId,
    appId,
    ciApproval,
    candidate
  }) {
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
      imageId: candidate.imageId || null,
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
    let previousRecovery = null
    let legacyCurrentState = null
    if (
      previousApp?.currentDeployment &&
      recovery.IMAGE_ID.test(candidateApp.imageId || '') &&
      !(await Setting.findOne({ key: recovery.key(previousApp.id) }))
    ) {
      try {
        const legacy = await sails.helpers.deploy.resolveLegacyRecovery.with({
          app: previousApp,
          currentOnly: true
        })
        if (legacy.available) legacyCurrentState = legacy.state
      } catch {
        // A new healthy deployment can proceed; do not invent unavailable legacy identity.
      }
    }

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
      await assertLease(deploymentId, leaseToken)
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

      // The route has been staged but App state has not changed yet. Recheck
      // ownership so a newer worker can never inherit this candidate.
      await assertLease(deploymentId, leaseToken)
      await transaction(async (db) => {
        if (appId) {
          const ciPolicy = await CiPolicy.findOne({
            app: appId
          }).usingConnection(db)
          const ciJob = await DeploymentJob.findOne({
            deployment: deploymentId
          }).usingConnection(db)
          if (ciApproval || (ciPolicy?.enabled && ciJob?.kind !== 'rollback')) {
            if (!ciApproval)
              throw new Error(
                'CI became required before traffic commit; this candidate has no server verification.'
              )
            await sails.helpers.ci.assertCutover.with({
              approval: ciApproval,
              appId,
              deploymentId,
              imageId: candidateApp.imageId,
              connection: db
            })
          }
        }
        if (leaseToken) {
          const owner = await DeploymentLease.findOne({
            deployment: deploymentId,
            token: leaseToken,
            expiresAt: { '>': Date.now() }
          }).usingConnection(db)
          if (!owner)
            throw Object.assign(
              new Error(
                'The deployment lease expired before App/recovery commit.'
              ),
              { code: 'DEPLOYMENT_LEASE_LOST' }
            )
        }
        if (previousApp)
          previousRecovery = await Setting.findOne({
            key: recovery.key(previousApp.id)
          }).usingConnection(db)
        if (
          previousRecovery &&
          !recovery.IMAGE_ID.test(candidateApp.imageId || '')
        )
          throw new Error(
            'A verified immutable image is required to advance recovery state.'
          )
        committedApp = previousApp
          ? await App.updateOne({
              id: previousApp.id,
              currentDeployment: previousApp.currentDeployment || null
            })
              .set(appValues(candidateApp))
              .usingConnection(db)
          : await App.create(appValues(candidateApp))
              .fetch()
              .usingConnection(db)
        if (
          committedApp &&
          recovery.IMAGE_ID.test(candidateApp.imageId || '')
        ) {
          if (legacyCurrentState && !previousRecovery) {
            const release = legacyCurrentState.current
            const source = await Deployment.findOne({
              id: release.deploymentId,
              app: previousApp.id,
              environment: environmentId
            }).usingConnection(db)
            if (
              !require('../../lib/legacy-deployment-artifact').verifyBinding(
                source,
                release,
                previousApp
              )
            )
              throw new Error(
                'The previous successful deployment identity changed before promotion.'
              )
            await Deployment.updateOne({ id: source.id })
              .set({ imageId: release.imageId })
              .usingConnection(db)
          }
          const job = await DeploymentJob.findOne({
            deployment: deploymentId
          }).usingConnection(db)
          await recovery.write(
            previousApp || committedApp,
            {
              deploymentId: String(deploymentId),
              imageId: candidateApp.imageId,
              promotedAt: candidateApp.lastDeployedAt,
              compatibility: candidate.recoveryCompatibility || null
            },
            job?.kind || 'deploy',
            db,
            legacyCurrentState
          )
          await Deployment.updateOne({ id: deploymentId })
            .set({ imageId: candidateApp.imageId, app: committedApp.id })
            .usingConnection(db)
        }
      })

      if (!committedApp) {
        throw new Error(
          'The candidate route loaded, but App state was not updated.'
        )
      }
      appStateCommitted = true

      // Fence the final route commit independently from the App write. If the
      // lease was lost, the catch path restores both pieces of state.
      await assertLease(deploymentId, leaseToken)
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
          await transaction(async (db) => {
            const owner = committedApp
              ? await App.findOne({ id: committedApp.id }).usingConnection(db)
              : null
            if (
              owner &&
              String(owner.currentDeployment) !== String(deploymentId)
            )
              throw new Error(
                'A different deployment owns App state; do not overwrite its recovery metadata.'
              )
            if (previousApp)
              await App.updateOne({ id: previousApp.id })
                .set(appValues(previousApp))
                .usingConnection(db)
            else if (committedApp)
              await App.destroyOne({ id: committedApp.id }).usingConnection(db)
            if (committedApp) {
              await Setting.destroy({
                key: recovery.key(committedApp.id)
              }).usingConnection(db)
              if (previousRecovery)
                await Setting.create({
                  key: previousRecovery.key,
                  value: previousRecovery.value
                }).usingConnection(db)
            }
          })
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
        const heldAppId = previousApp?.id || committedApp?.id
        if (heldAppId)
          await sails.helpers.setting
            .set(
              recovery.HOLD_PREFIX + String(heldAppId),
              JSON.stringify({
                deploymentId: String(deploymentId),
                createdAt: Date.now(),
                reason:
                  'Traffic or App restoration could not be verified. Inspect both containers and routing before clearing this hold.'
              })
            )
            .catch((error) => {
              rollbackError = combineErrors(rollbackError, error)
            })
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

async function assertLease(deploymentId, leaseToken) {
  const result = await sails.helpers.deploy.assertDeploymentLease.with({
    deploymentId,
    leaseToken
  })
  if (result?.valid === false) {
    const error = new Error(result.message)
    error.code = result.code
    throw error
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

  const triggeredBy =
    deployment?.triggeredBy && typeof deployment.triggeredBy === 'object'
      ? deployment.triggeredBy.id
      : deployment?.triggeredBy
  const team =
    environment?.project?.team && typeof environment.project.team === 'object'
      ? environment.project.team.id
      : environment?.project?.team

  return {
    userId: triggeredBy || undefined,
    teamId: team || undefined
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
