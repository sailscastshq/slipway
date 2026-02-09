const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'List Quest jobs',

  description: 'Get all scheduled jobs from a running app with sails-hook-quest.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
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

  fn: async function ({ projectSlug, environmentSlug }) {
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

    // Check if sails-quest is detected
    if (!environment.features || !environment.features['sails-quest']) {
      throw { badRequest: 'sails-hook-quest not detected in this app.' }
    }

    const app = await App.findOne({ environment: environment.id })

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    // Execute sails.quest.list() in the container
    const code = buildListJobsCode()
    const result = await executeInContainer(app.containerName, code)

    if (!result.success) {
      return {
        jobs: [],
        error: result.error
      }
    }

    try {
      const jobs = JSON.parse(result.output)
      return { jobs }
    } catch (e) {
      return {
        jobs: [],
        error: 'Failed to parse job list',
        raw: result.output
      }
    }
  }
}

function buildListJobsCode() {
  return `
(async () => {
  let sailsApp;
  try {
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        hooks: { http: false, views: false, sockets: false, pubsub: false, grunt: false },
        log: { level: 'warn' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    if (!sails.quest) {
      process.stdout.write(JSON.stringify([]));
      if (sailsApp.lower) sailsApp.lower(() => process.exit());
      else process.exit();
      return;
    }

    const jobs = sails.quest.list().map(job => ({
      name: job.name,
      friendlyName: job.friendlyName || job.name,
      description: job.description || '',
      schedule: job.cron || job.interval || job.timeout || null,
      scheduleType: job.cron ? 'cron' : (job.interval ? 'interval' : (job.timeout ? 'timeout' : 'unknown')),
      paused: !!job.paused,
      withoutOverlapping: !!job.withoutOverlapping,
      isRunning: sails.quest.isRunning ? sails.quest.isRunning(job.name) : false
    }));

    process.stdout.write(JSON.stringify(jobs));
  } catch (err) {
    process.stderr.write(err.stack || err.message);
    process.exitCode = 1;
  }

  if (sailsApp && sailsApp.lower) {
    sailsApp.lower(() => process.exit());
  } else {
    process.exit();
  }
})();
`
}

function executeInContainer(containerName, code) {
  return new Promise((resolve) => {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proc = spawn(dockerPath, ['exec', '-i', containerName, 'node'], {
      timeout: 30000
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.stdin.write(code)
    proc.stdin.end()

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
