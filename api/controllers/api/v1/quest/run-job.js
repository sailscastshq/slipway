const { spawn } = require('child_process')

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\[\d+(?:;\d+)*m/g
function stripAnsi(s) {
  return s.replace(ANSI_RE, '')
}

module.exports = {
  friendlyName: 'Run Quest job',

  description: 'Manually trigger a Quest job to run immediately.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
    },
    name: {
      type: 'string',
      required: true,
      description: 'Job name to run'
    },
    jobInputs: {
      type: 'ref',
      description: 'Optional inputs to pass to the job'
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

  fn: async function ({ projectSlug, environmentSlug, name, jobInputs }) {
    const user = await User.findOne({ id: this.req.session.userId })
    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    if (!environment.features || !environment.features['sails-quest']) {
      throw { badRequest: 'sails-hook-quest not detected in this app.' }
    }

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    // Build sails run command with inputs
    const args = ['exec', '-i', app.containerName, 'npx', 'sails', 'run', name]

    // Add inputs as command line args
    if (jobInputs && typeof jobInputs === 'object') {
      for (const [key, value] of Object.entries(jobInputs)) {
        const serialized =
          typeof value === 'object' && value !== null
            ? JSON.stringify(value)
            : String(value)
        args.push(`--${key}=${serialized}`)
      }
    }

    const startedAt = Date.now()
    const result = await executeInContainer(args)
    const duration = Date.now() - startedAt

    sails.log.info(
      `[quest] Job "${name}" triggered in ${project.slug}/${environmentSlug}`
    )

    // Record telemetry so manual runs appear in job history
    try {
      await TelemetryMetric.create({
        name: result.success ? 'quest.job.completed' : 'quest.job.failed',
        value: duration,
        unit: 'ms',
        attributes: {
          jobName: name,
          trigger: 'manual',
          triggeredBy: user.fullName,
          stdout: result.output || '',
          ...(result.success
            ? {}
            : {
                error: result.error || 'Unknown error',
                stderr: result.error || ''
              })
        },
        recordedAt: Date.now(),
        environment: environment.id
      })
    } catch (err) {
      sails.log.warn(
        '[quest] Failed to record telemetry for manual run:',
        err.message
      )
    }

    return {
      success: result.success,
      job: name,
      output: result.output,
      error: result.error,
      exitCode: result.exitCode,
      triggeredBy: user.fullName,
      triggeredAt: new Date().toISOString()
    }
  }
}

function executeInContainer(args) {
  return new Promise((resolve) => {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proc = spawn(dockerPath, args, {
      timeout: 300000 // 5 minute timeout for job execution
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (exitCode) => {
      resolve({
        success: exitCode === 0,
        output: stripAnsi(stdout.trim()),
        error: stripAnsi(stderr.trim()) || null,
        exitCode
      })
    })

    proc.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
        exitCode: 1
      })
    })
  })
}
