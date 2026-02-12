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
    }).populate('provider').populate('environment')

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

  // Trigger deployment
  sails.log.info(`[webhook] Triggering deployment for ${environment.slug}`)

  try {
    const deployment = await Deployment.create({
      status: 'pending',
      trigger: 'webhook',
      commitHash: commit,
      commitMessage: payload.head_commit?.message?.substring(0, 200),
      branch,
      pushedBy: pusher,
      environment: environment.id
    }).fetch()

    // Queue the actual deployment (async)
    setImmediate(async () => {
      try {
        await sails.helpers.deployment.triggerDeployment(deployment.id)
      } catch (err) {
        sails.log.error(`[webhook] Deployment failed: ${err.message}`)
      }
    })

    return {
      received: true,
      action: 'deployment_queued',
      deploymentId: deployment.id
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

  switch (action) {
    case 'opened':
    case 'synchronize':
      // Create or update preview environment
      // TODO: Implement preview environment creation
      return { received: true, action: 'preview_queued', prNumber }

    case 'closed':
      // Destroy preview environment
      // TODO: Implement preview environment cleanup
      return { received: true, action: 'preview_cleanup_queued', prNumber }

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

  // TODO: Clean up preview environments for deleted branches

  return { received: true, action: 'cleanup_queued', refType, ref }
}
