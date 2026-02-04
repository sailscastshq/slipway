const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Execute code',

  description: 'Execute JavaScript code inside a running app container (Helm REPL).',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to execute'
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

  fn: async function ({ projectSlug, environmentSlug, code }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate('team')

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({ project: project.id, slug: environmentSlug })

    if (!environment) {
      throw 'notFound'
    }

    const app = await App.findOne({ environment: environment.id })

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    // Build the wrapper that bootstraps Sails and evaluates user code
    const wrapperCode = buildWrapper(code)

    // Execute inside the container
    const result = await executeInContainer(app.containerName, wrapperCode)

    return result
  }
}

function buildWrapper(userCode) {
  // The wrapper loads Sails ORM context (models, helpers, config)
  // then evaluates the user's code in an async function
  return `
(async () => {
  let sailsApp;
  try {
    // Try to bootstrap Sails for full model/helper access
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
  } catch (e) {
    // If Sails isn't available, run in plain Node context
  }

  try {
    const __result = await (async function() {
      ${userCode}
    })();

    if (__result !== undefined) {
      if (typeof __result === 'string') {
        process.stdout.write(__result);
      } else {
        process.stdout.write(JSON.stringify(__result, null, 2));
      }
    }
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
    const proc = spawn('docker', ['exec', '-i', containerName, 'node'], {
      timeout: 30000 // 30 second timeout
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    // Send the code to stdin
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
