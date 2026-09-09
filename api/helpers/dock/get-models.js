const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const execFileAsync = promisify(execFile)
let inspectionQueue = Promise.resolve()
const pendingInspections = new Map()

module.exports = {
  friendlyName: 'Get Waterline models',

  description: 'Introspect sails.models from a running app container.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name of the running app'
    }
  },

  exits: {
    success: {
      description: 'Models retrieved successfully',
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName }) {
    if (pendingInspections.has(containerName)) {
      return pendingInspections.get(containerName)
    }
    const inspection = inspectionQueue.then(() =>
      inspectContainer(containerName)
    )
    pendingInspections.set(containerName, inspection)
    inspectionQueue = inspection.catch(() => {})
    try {
      return await inspection
    } finally {
      pendingInspections.delete(containerName)
    }
  }
}

async function inspectContainer(containerName) {
  const dockerPath = sails.config.docker?.binaryPath || 'docker'
  const snapshotName = `slipway-schema-${randomUUID()}`
  let created = false
  try {
    const { stdout } = await execFileAsync(
      dockerPath,
      ['inspect', containerName],
      {
        timeout: 5000,
        maxBuffer: 1024 * 1024
      }
    )
    const inspection = JSON.parse(stdout)[0]
    if (!inspection?.Image) throw new Error('Container unavailable')
    const code = buildIntrospectionCode(inspection.Config?.Env || [])
    const args = [
      'run',
      '--rm',
      '-i',
      '--name',
      snapshotName,
      '--memory',
      '512m',
      '--cpus',
      '0.5',
      '--pids-limit',
      '128',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--network',
      inspection.HostConfig?.NetworkMode || 'none',
      '--volumes-from',
      `${containerName}:ro`,
      '--workdir',
      inspection.Config?.WorkingDir || '/app',
      '--user',
      inspection.Config?.User || '0',
      '--entrypoint',
      'node',
      inspection.Image,
      '--max-old-space-size=256'
    ]
    created = true
    const result = await executeInContainer(args, code)
    if (!result.success) {
      return {
        models: {},
        error:
          'The app schema could not be loaded. Check its datastore connection and retry.'
      }
    }
    const models = JSON.parse(result.output)
    if (!Object.keys(models).length) throw new Error('No models')
    return { models }
  } catch {
    return {
      models: {},
      error:
        'The deployed app schema is unavailable. Check the app container and retry.'
    }
  } finally {
    if (created)
      await execFileAsync(dockerPath, ['rm', '-f', snapshotName], {
        timeout: 5000
      }).catch(() => {})
  }
}

function buildIntrospectionCode(environment = []) {
  return `
(async () => {
  let sailsApp;
  try {
    for (const value of ${JSON.stringify(environment)}) {
      const separator = value.indexOf('=');
      if (separator > 0) process.env[value.slice(0, separator)] = value.slice(separator + 1);
    }
    // Keep inspection from invoking an app's model-level auto-migrations.
    const path = require('node:path');
    const ormPath = path.dirname(require.resolve('sails-hook-orm'));
    const utils = require(require.resolve('waterline-utils', { paths: [ormPath] }));
    utils.autoMigrations = function(_strategy, _ontology, done) { done(); };
    sailsApp = require('sails');
    const runtimeConfig = require('sails/accessible/rc')('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        ...runtimeConfig,
        models: { ...runtimeConfig.models, migrate: 'safe' },
        loadHooks: ['moduleloader', 'userconfig', 'userhooks', 'orm'],
        log: { level: 'warn' }
      }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const models = {};
    for (const [identity, model] of Object.entries(sails.models)) {
      // Skip internal Waterline models
      if (identity.startsWith('_') || !model.attributes) continue;

      models[identity] = {
        identity: model.identity,
        tableName: model.tableName || model.identity,
        primaryKey: model.primaryKey || 'id',
        attributes: {}
      };

      for (const [attrName, originalAttr] of Object.entries({ ...model.attributes, ...model.schema })) {
        const attr = { ...model.attributes[attrName], ...originalAttr };
        const schemaAttr = model.schema?.[attrName] || {};
        const columnName = schemaAttr.columnName || attr.columnName || attrName;

        // Skip associations for now
        if (attr.collection || (attr.model && !schemaAttr.foreignKey)) continue;

        models[identity].attributes[attrName] = {
          type: attr.type,
          columnType:
            attr.columnType ||
            schemaAttr.columnType ||
            attr.autoMigrations?.columnType ||
            schemaAttr.autoMigrations?.columnType,
          columnName,
          required: attr.required || false,
          unique: attr.unique ?? attr.autoMigrations?.unique ?? false,
          autoIncrement: attr.autoIncrement ?? attr.autoMigrations?.autoIncrement ?? false,
          primaryKey: attr.primaryKey ?? (attrName === model.primaryKey),
          foreignKey: Boolean(schemaAttr.foreignKey),
          physical: { notNull: attr.autoMigrations?.notNull },
          defaultsTo: attr.defaultsTo,
          autoCreatedAt: attr.autoCreatedAt || false,
          autoUpdatedAt: attr.autoUpdatedAt || false,
          allowNull: attr.allowNull || false
        };
      }
    }

    process.stdout.write(JSON.stringify(models));
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

function executeInContainer(args, code) {
  return new Promise((resolve) => {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proc = spawn(dockerPath, args, {
      timeout: 25000 // Bound both the Docker client and its inspection child
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
      if (Buffer.byteLength(stdout) > 4 * 1024 * 1024) proc.kill()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
      if (Buffer.byteLength(stderr) > 1024 * 1024) proc.kill()
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
