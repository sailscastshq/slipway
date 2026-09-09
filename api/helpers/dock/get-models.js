const canonicalModelSnapshot = require('../../lib/canonical-model-snapshot')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash, randomUUID } = require('node:crypto')
const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Get Waterline models',

  description: 'Introspect sails.models from a running app container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name of the running app'
    },
    datastore: { type: 'string', defaultsTo: 'default' }
  },

  exits: {
    success: {
      description: 'Models retrieved successfully',
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, datastore = 'default' }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    let inspection
    try {
      const { stdout } = await execFileAsync(
        dockerPath,
        ['inspect', containerName],
        { timeout: 5000, maxBuffer: 1024 * 1024 }
      )
      inspection = JSON.parse(stdout)[0]
      if (!inspection?.State || !inspection?.Image)
        throw new Error('Not a container')
    } catch {
      return {
        models: {},
        authoritative: false,
        error:
          'The deployed app container is unavailable. Deploy the target revision before comparing its schema.'
      }
    }
    if (
      !inspection.State.Running &&
      (inspection.Config?.Env || []).some((item) =>
        /^(NODE_OPTIONS|NODE_PATH|LD_PRELOAD|LD_LIBRARY_PATH)=.+/.test(item)
      )
    ) {
      return {
        models: {},
        authoritative: false,
        error:
          'This stopped app uses startup loader settings that cannot be reproduced safely. Start the app to obtain its normalized schema.'
      }
    }
    const snapshotName = `slipway-schema-${randomUUID()}`
    const code = buildIntrospectionCode(datastore, inspection.Config?.Env || [])
    const args = inspection.State.Running
      ? ['exec', '-i', containerName, 'timeout', '-s', 'KILL', '60', 'node']
      : [
          'run',
          '--rm',
          '-i',
          '--name',
          snapshotName,
          '--volumes-from',
          `${containerName}:ro`,
          '--network',
          inspection.HostConfig?.NetworkMode || 'none',
          '--workdir',
          inspection.Config?.WorkingDir || '/',
          '--user',
          inspection.Config?.User || '0',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--memory',
          '512m',
          '--pids-limit',
          '128',
          '--entrypoint',
          'node',
          inspection.Image
        ]
    try {
      const result = await executeInContainer(args, code)
      if (!result.success)
        return {
          models: {},
          authoritative: false,
          error:
            'Could not load the app schema safely. Check the app configuration and datastore availability, then retry.'
        }
      const models = JSON.parse(result.output)
      if (!Object.keys(models).length)
        return {
          models: {},
          authoritative: false,
          error: `No normalized models were found for datastore "${datastore}".`
        }
      return {
        models,
        datastore,
        authoritative: true,
        formatVersion: 1,
        source: {
          image: inspection.Image,
          configFingerprint: createHash('sha256')
            .update(
              JSON.stringify({
                env: inspection.Config?.Env,
                directory: inspection.Config?.WorkingDir,
                mounts: inspection.Mounts,
                datastore
              })
            )
            .digest('hex')
        }
      }
    } catch {
      return {
        models: {},
        authoritative: false,
        error: 'The app did not return a valid normalized schema snapshot.'
      }
    } finally {
      if (!inspection.State.Running)
        await execFileAsync(dockerPath, ['rm', '-f', snapshotName], {
          timeout: 5000
        }).catch(() => {})
    }
  }
}

function buildIntrospectionCode(datastore = 'default', environment = []) {
  return `
(async () => {
  let sailsApp;
  try {
    for (const item of ${JSON.stringify(environment)}) {
      const separator = item.indexOf('=');
      if (separator > 0) process.env[item.slice(0, separator)] = item.slice(separator + 1);
    }
    // Introspection must never invoke adapter auto-migrations, even when an app model opts in.
    const path = require('node:path');
    const ormPath = path.dirname(require.resolve('sails-hook-orm'));
    const utils = require(require.resolve('waterline-utils', { paths: [ormPath] }));
    utils.autoMigrations = function(_strategy, _ontology, done) { done(); };

    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        models: { migrate: 'safe' },
        hooks: { http: false, views: false, sockets: false, pubsub: false, grunt: false, shipwright: false, content: false, quest: false },
        log: { level: 'warn' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const normalize = ${canonicalModelSnapshot.toString()};
    const models = normalize(sailsApp.models, ${JSON.stringify(datastore)});

    await new Promise((resolve) => process.stdout.write(JSON.stringify(models), resolve));
  } catch (err) {
    process.stderr.write('Schema introspection failed.');
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

function executeInContainer(args, code) {
  return new Promise((resolve) => {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proc = spawn(dockerPath, args, {
      timeout: 65000 // The in-container process has its own 60-second deadline
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
      if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) proc.kill('SIGKILL')
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      if (Buffer.byteLength(stderr) > 1024 * 1024) proc.kill('SIGKILL')
    })

    proc.stdin.on('error', () => {})
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

module.exports._private = { buildIntrospectionCode }
