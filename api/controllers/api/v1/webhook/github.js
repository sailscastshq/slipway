const crypto = require('crypto')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { isContentCommit } = require('../../../../lib/content-commit')

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

    if (!project.webhookSecret) {
      sails.log.warn(
        `Webhook received for ${projectSlug} but no webhook secret is configured`
      )
      return { message: 'Webhook not configured' }
    }

    // Verify GitHub signature
    const signature = this.req.headers['x-hub-signature-256']
    if (!signature) {
      throw 'forbidden'
    }

    const rawBody = this.req.body
    const payload =
      typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)
    const expectedSig =
      'sha256=' +
      crypto
        .createHmac('sha256', project.webhookSecret)
        .update(payload)
        .digest('hex')

    if (
      !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))
    ) {
      sails.log.warn(`Invalid webhook signature for ${projectSlug}`)
      throw 'forbidden'
    }

    // Parse event
    const event = this.req.headers['x-github-event']
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody

    if (event !== 'push') {
      return {
        received: true,
        action: 'ignored',
        reason: 'unsupported_event'
      }
    }

    if (!project.autoDeploy) {
      sails.log.warn(
        `Push webhook received for ${projectSlug} but auto-deploy is not enabled`
      )
      return { message: 'Auto-deploy not enabled' }
    }

    if (isContentCommit(body.head_commit?.message)) {
      return { message: 'Content Manager commit handled by Slipway' }
    }

    // Check branch
    const ref = body.ref || ''
    const branch = ref.replace('refs/heads/', '')

    if (branch !== project.autoDeployBranch) {
      sails.log.verbose(
        `Webhook push to ${branch} — skipping (auto-deploy branch: ${project.autoDeployBranch})`
      )
      return {
        message: `Skipped: push to ${branch}, auto-deploy branch is ${project.autoDeployBranch}`
      }
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
        execFileSync('git', ['fetch', 'origin', branch], {
          cwd: targetDir,
          timeout: 120000
        })
        execFileSync('git', ['reset', '--hard', `origin/${branch}`], {
          cwd: targetDir,
          timeout: 30000
        })
        execFileSync('git', ['clean', '-fd'], {
          cwd: targetDir,
          timeout: 30000
        })
      } else {
        // Fresh clone
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }
        execFileSync(
          'git',
          [
            'clone',
            '--branch',
            branch,
            '--single-branch',
            '--depth',
            '1',
            repoUrl,
            targetDir
          ],
          {
            timeout: 120000
          }
        )
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

    // Deploy all apps in the environment
    const apps = await App.find({ environment: environment.id })
    const deploymentIds = []

    for (const app of apps.length > 0 ? apps : [null]) {
      const queued = await sails.helpers.deploy.queueDeployment.with({
        values: {
          gitCommit: body.after || body.head_commit?.id,
          gitBranch: branch,
          gitMessage: body.head_commit?.message,
          triggeredBy: owner ? owner.id : null,
          triggerType: 'webhook',
          environment: environment.id
        },
        app
      })
      const deployment = queued.deployment

      deploymentIds.push(deployment.id)

      sails.log.info(
        `Webhook auto-deploy triggered for ${projectSlug}: ${deployment.id}`
      )
    }

    return {
      message: 'Deployment triggered',
      deploymentIds
    }
  }
}
