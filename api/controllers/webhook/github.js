const path = require('path')

/**
 * GitHub Webhook Handler
 */
module.exports = {
  friendlyName: 'GitHub Webhook',

  description: 'Handle GitHub webhook events (push, PR, delete).',

  inputs: {},

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function () {
    const signature = this.req.headers['x-hub-signature-256']
    const event = this.req.headers['x-github-event']
    const deliveryId = this.req.headers['x-github-delivery']
    const payload = this.req.body

    sails.log.info(`[webhook] GitHub ${event} event received (${deliveryId})`)

    // Find repository by external ID
    const repoId = payload.repository?.id
    if (!repoId) {
      sails.log.warn('[webhook] No repository ID in payload')
      return { received: true, action: 'ignored' }
    }

    const repo = await GitRepository.findOne({
      externalId: String(repoId)
    }).populate('provider').populate('environment').populate('app').decrypt()

    if (!repo) {
      sails.log.warn(`[webhook] Unknown repository: ${repoId}`)
      return { received: true, action: 'unknown_repo' }
    }

    // Verify webhook signature
    const rawBody = JSON.stringify(payload)
    const isValid = await sails.helpers.git.verifyWebhookSignature(
      rawBody,
      signature,
      repo.webhookSecret
    )

    if (!isValid) {
      sails.log.warn(`[webhook] Invalid signature for repo ${repo.fullName}`)
      throw 'forbidden'
    }

    // Handle event based on type
    switch (event) {
      case 'push':
        return await handlePush(repo, payload)

      case 'pull_request':
        return await handlePullRequest(repo, payload)

      case 'delete':
        return await handleDelete(repo, payload)

      case 'ping':
        sails.log.info(`[webhook] Ping received for ${repo.fullName}`)
        return { received: true, action: 'pong' }

      default:
        sails.log.verbose(`[webhook] Ignoring event: ${event}`)
        return { received: true, action: 'ignored' }
    }
  }
}

/**
 * Handle push events - trigger deployment
 */
async function handlePush(repo, payload) {
  const branch = payload.ref?.replace('refs/heads/', '')
  const commit = payload.after
  const pusher = payload.pusher?.name

  sails.log.info(`[webhook] Push to ${repo.fullName}/${branch} by ${pusher}`)

  // Check if auto-deploy is enabled
  if (!repo.autoDeploy) {
    sails.log.verbose('[webhook] Auto-deploy disabled, skipping')
    return { received: true, action: 'skipped', reason: 'auto_deploy_disabled' }
  }

  // Check branch mapping
  const branchMappings = repo.branchMappings || {}
  const targetEnvSlug = branchMappings[branch]

  if (!targetEnvSlug && branch !== repo.defaultBranch) {
    sails.log.verbose(`[webhook] No mapping for branch ${branch}, skipping`)
    return { received: true, action: 'skipped', reason: 'no_branch_mapping' }
  }

  // Find target environment
  const environment = repo.environment
  if (!environment) {
    sails.log.warn('[webhook] Repository not linked to environment')
    return { received: true, action: 'skipped', reason: 'no_environment' }
  }

  // Trigger deployment for all apps in environment
  sails.log.info(`[webhook] Triggering deployment for ${environment.slug}`)

  try {
    const envRecord = await Environment.findOne({ id: environment.id }).populate('project')
    const project = envRecord.project

    // Clone or pull the repo source code before building
    const targetDir = path.join(sails.config.custom.slipwayAppsDir, project.slug)
    if (!repo.deployKeyPrivate) {
      sails.log.warn(`[webhook] No deploy key found for ${repo.fullName} — was the key decrypted?`)
    }
    await sails.helpers.git.cloneOrPull.with({
      cloneUrl: repo.cloneUrl,
      branch,
      targetDir,
      deployKeyPrivate: repo.deployKeyPrivate
    })

    // If repo is linked to a specific app, deploy only that app.
    // Otherwise, deploy all apps in the environment.
    let apps
    if (repo.app) {
      apps = [repo.app]
      sails.log.info(`[webhook] Scoping deploy to app: ${repo.app.name || repo.app.slug}`)
    } else {
      apps = await App.find({ environment: environment.id })
    }
    const deploymentIds = []

    for (const app of (apps.length > 0 ? apps : [null])) {
      const deployment = await Deployment.create({
        status: 'pending',
        triggerType: 'webhook',
        gitCommit: commit,
        gitMessage: payload.head_commit?.message?.substring(0, 200),
        gitBranch: branch,
        environment: environment.id,
        app: app ? app.id : undefined,
        startedAt: Date.now()
      }).fetch()

      deploymentIds.push(deployment.id)

      process.nextTick(async () => {
        try {
          await sails.helpers.deploy.executePipeline.with({
            deploymentId: deployment.id,
            project,
            environment,
            app
          })
        } catch (err) {
          sails.log.error(`[webhook] Deployment ${deployment.id} failed: ${err.message || err}`)
        }
      })
    }

    return {
      received: true,
      action: 'deployment_queued',
      deploymentIds
    }
  } catch (err) {
    sails.log.error(`[webhook] Failed to create deployment: ${err.message}`)
    return { received: true, action: 'error', error: err.message }
  }
}

/**
 * Handle pull request events - preview environments
 */
async function handlePullRequest(repo, payload) {
  const action = payload.action
  const prNumber = payload.pull_request?.number
  const branch = payload.pull_request?.head?.ref

  sails.log.info(`[webhook] PR #${prNumber} ${action} on ${repo.fullName}`)

  if (!repo.autoDeployPreviews) {
    return { received: true, action: 'skipped', reason: 'previews_disabled' }
  }

  // Need the project to create preview environment
  const environment = await Environment.findOne({ id: repo.environment.id || repo.environment }).populate('project')
  if (!environment || !environment.project) {
    return { received: true, action: 'skipped', reason: 'no_project' }
  }
  const project = await Project.findOne({ id: environment.project.id || environment.project })

  switch (action) {
    case 'opened':
    case 'synchronize':
    case 'reopened': {
      const previewEnv = await sails.helpers.preview.createPreviewEnvironment.with({
        project,
        prNumber,
        branch
      })
      return { received: true, action: 'preview_queued', prNumber, environmentId: previewEnv.id }
    }

    case 'closed':
      await sails.helpers.preview.destroyPreviewEnvironment.with({
        project,
        prNumber
      })
      return { received: true, action: 'preview_destroyed', prNumber }

    default:
      return { received: true, action: 'ignored' }
  }
}

/**
 * Handle delete events - cleanup
 */
async function handleDelete(repo, payload) {
  const refType = payload.ref_type
  const ref = payload.ref

  sails.log.info(`[webhook] ${refType} "${ref}" deleted on ${repo.fullName}`)

  // Clean up preview environments associated with deleted branches
  if (refType === 'branch') {
    const environment = await Environment.findOne({ id: repo.environment.id || repo.environment }).populate('project')
    if (environment && environment.project) {
      const project = await Project.findOne({ id: environment.project.id || environment.project })
      if (project) {
        // Find preview environments that match this branch (pr-* slugs)
        const previewEnvs = await Environment.find({ project: project.id, isPreview: true })
        for (const preview of previewEnvs) {
          if (preview.prNumber) {
            try {
              await sails.helpers.preview.destroyPreviewEnvironment.with({
                project,
                prNumber: preview.prNumber
              })
              sails.log.info(`[webhook] Cleaned up preview environment pr-${preview.prNumber} for deleted branch "${ref}"`)
            } catch (err) {
              sails.log.warn(`[webhook] Failed to clean up preview pr-${preview.prNumber}: ${err.message}`)
            }
          }
        }
      }
    }
  }

  return { received: true, action: 'cleanup_completed', refType, ref }
}
