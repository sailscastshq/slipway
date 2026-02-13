const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

module.exports = {
  friendlyName: 'GitHub webhook',

  description: 'Handle GitHub push webhook to trigger auto-deploy.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ projectSlug }) {
    const project = await Project.findOne({ slug: projectSlug })

    if (!project) {
      throw 'notFound'
    }

    if (!project.webhookSecret || !project.autoDeploy) {
      sails.log.warn(`Webhook received for ${projectSlug} but auto-deploy is not enabled`)
      return { message: 'Auto-deploy not enabled' }
    }

    // Verify GitHub signature
    const signature = this.req.headers['x-hub-signature-256']
    if (!signature) {
      throw 'forbidden'
    }

    const rawBody = this.req.body
    const payload = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
    const expectedSig = 'sha256=' + crypto
      .createHmac('sha256', project.webhookSecret)
      .update(payload)
      .digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      sails.log.warn(`Invalid webhook signature for ${projectSlug}`)
      throw 'forbidden'
    }

    // Parse event
    const event = this.req.headers['x-github-event']
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody

    // Handle pull_request events for preview environments
    if (event === 'pull_request') {
      return await handlePullRequest(project, body)
    }

    if (event !== 'push') {
      return { message: `Ignored event: ${event}` }
    }

    // Check branch
    const ref = body.ref || ''
    const branch = ref.replace('refs/heads/', '')

    if (branch !== project.autoDeployBranch) {
      sails.log.verbose(`Webhook push to ${branch} — skipping (auto-deploy branch: ${project.autoDeployBranch})`)
      return { message: `Skipped: push to ${branch}, auto-deploy branch is ${project.autoDeployBranch}` }
    }

    // Clone/pull the repo
    const repoUrl = project.repositoryUrl
    if (!repoUrl) {
      sails.log.warn(`No repository URL configured for ${projectSlug}`)
      return { message: 'No repository URL configured' }
    }

    const targetDir = path.join(sails.config.custom.slipwayAppsDir, projectSlug)

    // Ensure apps directory exists
    fs.mkdirSync(sails.config.custom.slipwayAppsDir, { recursive: true })

    try {
      if (fs.existsSync(path.join(targetDir, '.git'))) {
        // Pull latest
        execFileSync('git', ['fetch', 'origin', branch], { cwd: targetDir, timeout: 120000 })
        execFileSync('git', ['reset', '--hard', `origin/${branch}`], { cwd: targetDir, timeout: 30000 })
        execFileSync('git', ['clean', '-fd'], { cwd: targetDir, timeout: 30000 })
      } else {
        // Fresh clone
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }
        execFileSync('git', ['clone', '--branch', branch, '--single-branch', '--depth', '1', repoUrl, targetDir], {
          timeout: 120000
        })
      }
    } catch (err) {
      sails.log.error(`Failed to clone/pull for ${projectSlug}: ${err.message}`)
      return { message: `Git error: ${err.message}` }
    }

    // Find the default environment (production) and trigger deploy
    const environment = await Environment.findOne({
      project: project.id,
      slug: 'production'
    })

    if (!environment) {
      sails.log.warn(`No production environment for ${projectSlug}`)
      return { message: 'No production environment found' }
    }

    // Get the team owner to use as the deployer
    const owner = await User.findOne({ id: project.createdBy })

    // Create deployment
    const deployment = await Deployment.create({
      status: 'pending',
      gitCommit: body.after || body.head_commit?.id,
      gitBranch: branch,
      gitMessage: body.head_commit?.message,
      triggeredBy: owner ? owner.id : null,
      triggerType: 'webhook',
      environment: environment.id,
      startedAt: Date.now()
    }).fetch()

    sails.log.info(`Webhook auto-deploy triggered for ${projectSlug}: ${deployment.id}`)

    // Kick off async deployment (same pattern as trigger-deployment)
    process.nextTick(async () => {
      try {
        await Deployment.updateOne({ id: deployment.id }).set({ status: 'building' })
        await sails.helpers.docker.ensureNetwork()

        const imageName = await App.generateImageName(environment.id, deployment.id)
        const containerName = await App.generateContainerName(environment.id)
        const contextPath = path.join(sails.config.custom.slipwayAppsDir, projectSlug)

        await sails.helpers.docker.buildImage.with({
          contextPath,
          imageName,
          dockerfilePath: project.dockerfilePath || 'Dockerfile',
          deploymentId: deployment.id
        })

        // Detect Sails features (sails-content, sails-quest, etc.)
        const detectedFeatures = await sails.helpers.sails.detectFeatures(contextPath)
        if (Object.keys(detectedFeatures).length > 0) {
          await Environment.updateOne({ id: environment.id }).set({
            features: detectedFeatures
          })
          await Deployment.appendBuildLog(deployment.id, `Detected features: ${Object.keys(detectedFeatures).join(', ')}\n`)
        }

        await Deployment.updateOne({ id: deployment.id }).set({
          imageName,
          status: 'deploying'
        })

        const hostPort = await sails.helpers.docker.allocatePort()

        // Merge global env vars with environment-specific vars
        let globalEnvVars = {}
        try {
          const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
          globalEnvVars = JSON.parse(globalJson)
        } catch { /* ignore parse errors */ }

        const envRecord = await Environment.findOne({ id: environment.id })
        const envVars = { ...globalEnvVars, ...(envRecord.envVars || {}) }

        // Auto-inject Slipway telemetry env vars
        if (envRecord.telemetryToken) {
          envVars.SLIPWAY_TELEMETRY_URL = `${sails.config.custom.baseUrl}/api/v1/telemetry/ingest`
          envVars.SLIPWAY_TELEMETRY_TOKEN = envRecord.telemetryToken
        }

        const existingApp = await App.findOne({ environment: environment.id })
        const resourceLimits = (existingApp && existingApp.resourceLimits) || { cpus: '1', memory: '512m' }

        const containerResult = await sails.helpers.docker.runContainer.with({
          imageName,
          containerName,
          port: 1337,
          hostPort,
          envVars,
          deploymentId: deployment.id,
          resourceLimits
        })

        if (existingApp) {
          await App.updateOne({ id: existingApp.id }).set({
            status: 'running',
            containerId: containerResult.containerId,
            containerName: containerResult.containerName,
            imageName,
            port: 1337,
            hostPort: containerResult.hostPort,
            lastDeployedAt: Date.now(),
            currentDeployment: deployment.id
          })
        } else {
          await App.create({
            status: 'running',
            containerId: containerResult.containerId,
            containerName: containerResult.containerName,
            imageName,
            port: 1337,
            hostPort: containerResult.hostPort,
            lastDeployedAt: Date.now(),
            environment: environment.id,
            currentDeployment: deployment.id
          })
        }

        try {
          await sails.helpers.caddy.updateRoute(environment.id)
        } catch (caddyErr) {
          sails.log.warn(`Caddy route update failed: ${caddyErr.message}`)
        }

        // Mark previous running deployments as stopped
        await Deployment.update({ environment: environment.id, status: 'running', id: { '!=': deployment.id } })
          .set({ status: 'stopped' })

        await Deployment.updateOne({ id: deployment.id }).set({
          status: 'running',
          finishedAt: Date.now()
        })

        sails.log.info(`Webhook deploy ${deployment.id} completed`)
      } catch (err) {
        sails.log.error(`Webhook deploy ${deployment.id} failed: ${err.message}`)
        const current = await Deployment.findOne({ id: deployment.id })
        if (current && current.status !== 'failed') {
          await Deployment.updateOne({ id: deployment.id }).set({
            status: 'failed',
            errorMessage: err.message,
            finishedAt: Date.now()
          })
        }
      }
    })

    return {
      message: 'Deployment triggered',
      deploymentId: deployment.id
    }
  }
}

/**
 * Handle pull_request webhook events for preview environments.
 * - opened/synchronize: create preview env + deploy
 * - closed: destroy preview env
 */
async function handlePullRequest(project, body) {
  const action = body.action
  const pr = body.pull_request
  if (!pr) return { message: 'No pull_request payload' }

  const prNumber = pr.number
  const branch = pr.head.ref

  if (action === 'opened' || action === 'synchronize' || action === 'reopened') {
    // Create or get preview environment
    const environment = await sails.helpers.preview.createPreviewEnvironment({
      project,
      prNumber,
      branch
    })

    // Clone/pull the PR branch
    const repoUrl = project.repositoryUrl
    if (!repoUrl) {
      return { message: 'No repository URL configured' }
    }

    const targetDir = path.join(sails.config.custom.slipwayAppsDir, project.slug)

    fs.mkdirSync(sails.config.custom.slipwayAppsDir, { recursive: true })

    try {
      if (fs.existsSync(path.join(targetDir, '.git'))) {
        execFileSync('git', ['fetch', 'origin', branch], { cwd: targetDir, timeout: 120000 })
        execFileSync('git', ['checkout', '-B', branch, `origin/${branch}`], { cwd: targetDir, timeout: 30000 })
        execFileSync('git', ['clean', '-fd'], { cwd: targetDir, timeout: 30000 })
      } else {
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }
        execFileSync('git', ['clone', '--branch', branch, '--single-branch', '--depth', '1', repoUrl, targetDir], {
          timeout: 120000
        })
      }
    } catch (err) {
      sails.log.error(`Failed to clone/pull PR branch for ${project.slug}: ${err.message}`)
      return { message: `Git error: ${err.message}` }
    }

    // Get owner for deployer
    const owner = await User.findOne({ id: project.createdBy })

    // Create deployment
    const deployment = await Deployment.create({
      status: 'pending',
      gitCommit: pr.head.sha,
      gitBranch: branch,
      gitMessage: pr.title,
      triggeredBy: owner ? owner.id : null,
      triggerType: 'webhook',
      environment: environment.id,
      startedAt: Date.now()
    }).fetch()

    sails.log.info(`Preview deploy triggered for ${project.slug}/pr-${prNumber}: ${deployment.id}`)

    // Kick off async deployment
    process.nextTick(async () => {
      try {
        await Deployment.updateOne({ id: deployment.id }).set({ status: 'building' })
        await sails.helpers.docker.ensureNetwork()

        const imageName = await App.generateImageName(environment.id, deployment.id)
        const containerName = await App.generateContainerName(environment.id)
        const contextPath = path.join(sails.config.custom.slipwayAppsDir, project.slug)

        await sails.helpers.docker.buildImage.with({
          contextPath,
          imageName,
          dockerfilePath: project.dockerfilePath || 'Dockerfile',
          deploymentId: deployment.id
        })

        // Detect Sails features (sails-content, sails-quest, etc.)
        const detectedFeatures = await sails.helpers.sails.detectFeatures(contextPath)
        if (Object.keys(detectedFeatures).length > 0) {
          await Environment.updateOne({ id: environment.id }).set({
            features: detectedFeatures
          })
          await Deployment.appendBuildLog(deployment.id, `Detected features: ${Object.keys(detectedFeatures).join(', ')}\n`)
        }

        await Deployment.updateOne({ id: deployment.id }).set({ imageName, status: 'deploying' })

        const hostPort = await sails.helpers.docker.allocatePort()

        // Merge global env vars with environment-specific vars
        let globalEnvVars = {}
        try {
          const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
          globalEnvVars = JSON.parse(globalJson)
        } catch { /* ignore parse errors */ }

        const envRecord = await Environment.findOne({ id: environment.id })
        const envVars = { ...globalEnvVars, ...(envRecord.envVars || {}) }

        // Auto-inject Slipway telemetry env vars
        if (envRecord.telemetryToken) {
          envVars.SLIPWAY_TELEMETRY_URL = `${sails.config.custom.baseUrl}/api/v1/telemetry/ingest`
          envVars.SLIPWAY_TELEMETRY_TOKEN = envRecord.telemetryToken
        }

        const existingApp = await App.findOne({ environment: environment.id })
        const resourceLimits = (existingApp && existingApp.resourceLimits) || { cpus: '1', memory: '512m' }

        const containerResult = await sails.helpers.docker.runContainer.with({
          imageName,
          containerName,
          port: 1337,
          hostPort,
          envVars,
          deploymentId: deployment.id,
          resourceLimits
        })

        if (existingApp) {
          await App.updateOne({ id: existingApp.id }).set({
            status: 'running',
            containerId: containerResult.containerId,
            containerName: containerResult.containerName,
            imageName,
            port: 1337,
            hostPort: containerResult.hostPort,
            lastDeployedAt: Date.now(),
            currentDeployment: deployment.id
          })
        } else {
          await App.create({
            status: 'running',
            containerId: containerResult.containerId,
            containerName: containerResult.containerName,
            imageName,
            port: 1337,
            hostPort: containerResult.hostPort,
            lastDeployedAt: Date.now(),
            environment: environment.id,
            currentDeployment: deployment.id
          })
        }

        try {
          await sails.helpers.caddy.updateRoute(environment.id)
        } catch (caddyErr) {
          sails.log.warn(`Caddy route update failed for preview: ${caddyErr.message}`)
        }

        await Deployment.update({ environment: environment.id, status: 'running', id: { '!=': deployment.id } })
          .set({ status: 'stopped' })

        await Deployment.updateOne({ id: deployment.id }).set({
          status: 'running',
          finishedAt: Date.now()
        })

        sails.log.info(`Preview deploy ${deployment.id} completed for PR #${prNumber}`)
      } catch (err) {
        sails.log.error(`Preview deploy ${deployment.id} failed: ${err.message}`)
        const current = await Deployment.findOne({ id: deployment.id })
        if (current && current.status !== 'failed') {
          await Deployment.updateOne({ id: deployment.id }).set({
            status: 'failed',
            errorMessage: err.message,
            finishedAt: Date.now()
          })
        }
      }
    })

    return {
      message: `Preview deployment triggered for PR #${prNumber}`,
      deploymentId: deployment.id
    }
  } else if (action === 'closed') {
    // Destroy preview environment
    await sails.helpers.preview.destroyPreviewEnvironment({
      project,
      prNumber
    })

    return { message: `Preview environment for PR #${prNumber} destroyed` }
  }

  return { message: `Ignored PR action: ${action}` }
}
