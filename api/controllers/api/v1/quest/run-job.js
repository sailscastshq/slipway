const { spawn } = require('child_process')

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
    const project = await Project.findOne({ slug: projectSlug }).populate('team')

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

    const app = await App.findOne({ environment: environment.id, isDefault: true }) || await App.findOne({ environment: environment.id })

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    // Build sails run command with inputs
    const args = ['exec', '-i', app.containerName, 'npx', 'sails', 'run', name]

    // Add inputs as command line args
    if (jobInputs && typeof jobInputs === 'object') {
      for (const [key, value] of Object.entries(jobInputs)) {
        const serialized = typeof value === 'object' && value !== null
          ? JSON.stringify(value)
          : String(value)
        args.push(`--${key}=${serialized}`)
      }
    }

    const result = await executeInContainer(args)

    sails.log.info(`[quest] Job "${name}" triggered in ${project.slug}/${environmentSlug}`)

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
        output: stdout.trim(),
        error: stderr.trim() || null,
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
