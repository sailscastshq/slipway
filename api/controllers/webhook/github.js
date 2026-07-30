const path = require('path')
const { isContentCommit } = require('../../lib/content-commit')

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
    })
      .populate('provider')
      .populate('environment')
      .populate('app')
      .decrypt()

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
      case 'delete':
        sails.log.verbose(`[webhook] Ignoring unsupported event: ${event}`)
        return {
          received: true,
          action: 'ignored',
          reason: 'unsupported_event'
        }

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

  // Content Manager owns deployment orchestration for its commits. Skipping
  // here keeps Save as commit-only and Save & Deploy to exactly one pipeline.
  if (isContentCommit(payload.head_commit?.message)) {
    return {
      received: true,
      action: 'skipped',
      reason: 'content_manager_commit'
    }
  }

  sails.log.info(`[webhook] Push to ${repo.fullName}/${branch} by ${pusher}`)

  // Check if auto-deploy is enabled
  if (!repo.autoDeploy) {
    sails.log.verbose('[webhook] Auto-deploy disabled, skipping')
    return { received: true, action: 'skipped', reason: 'auto_deploy_disabled' }
  }

  // Check branch mapping — if mappings are configured, only deploy mapped branches.
  // Fall back to defaultBranch only when no mappings exist at all.
  const branchMappings = repo.branchMappings || {}
  const hasMappings = Object.keys(branchMappings).length > 0
  const targetEnvSlug = branchMappings[branch]

  if (hasMappings && !targetEnvSlug) {
    sails.log.verbose(
      `[webhook] No mapping for branch ${branch}, skipping (mappings: ${JSON.stringify(
        branchMappings
      )})`
    )
    return { received: true, action: 'skipped', reason: 'no_branch_mapping' }
  }

  if (!hasMappings && branch !== repo.defaultBranch) {
    sails.log.verbose(
      `[webhook] No mappings configured and ${branch} is not the default branch, skipping`
    )
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
    const envRecord = await Environment.findOne({
      id: environment.id
    }).populate('project')
    const project = envRecord.project

    // Clone or pull the repo source code before building
    const targetDir = path.join(
      sails.config.custom.slipwayAppsDir,
      project.slug
    )
    if (!repo.deployKeyPrivate) {
      sails.log.warn(
        `[webhook] No deploy key found for ${repo.fullName} — was the key decrypted?`
      )
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
      sails.log.info(
        `[webhook] Scoping deploy to app: ${repo.app.name || repo.app.slug}`
      )
    } else {
      apps = await App.find({ environment: environment.id })
    }
    const deploymentIds = []

    for (const app of apps.length > 0 ? apps : [null]) {
      const queued = await sails.helpers.deploy.queueDeployment.with({
        values: {
          triggerType: 'webhook',
          gitCommit: commit,
          gitMessage: payload.head_commit?.message?.substring(0, 200),
          gitBranch: branch,
          environment: environment.id
        },
        app
      })
      const deployment = queued.deployment

      deploymentIds.push(deployment.id)
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
