const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Pause Quest job',

  description: 'Pause a scheduled Quest job.',

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
      description: 'Job name to pause'
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

  fn: async function ({ projectSlug, environmentSlug, name }) {
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

    const app = await App.findOne({ environment: environment.id })

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    const code = buildPauseJobCode(name)
    const result = await executeInContainer(app.containerName, code)

    sails.log.info(`[quest] Job "${name}" paused in ${project.slug}/${environmentSlug}`)

    return {
      success: result.success,
      job: name,
      action: 'paused',
      error: result.error
    }
  }
}

function buildPauseJobCode(jobName) {
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
      throw new Error('sails.quest is not available');
    }

    const result = sails.quest.pause('${jobName}');
    process.stdout.write(JSON.stringify({ success: result }));
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
