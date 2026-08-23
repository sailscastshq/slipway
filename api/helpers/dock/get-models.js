const { spawn } = require('child_process')

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
    const code = buildIntrospectionCode()
    const result = await executeInContainer(containerName, code)

    if (!result.success) {
      return { models: {}, error: result.error }
    }

    try {
      const models = JSON.parse(result.output)
      return { models }
    } catch (err) {
      return { models: {}, error: 'Failed to parse models: ' + err.message }
    }
  }
}

function buildIntrospectionCode() {
  return `
(async () => {
  let sailsApp;
  try {
    sailsApp = require('sails');
    await new Promise((resolve, reject) => {
      sailsApp.load({
        models: { migrate: 'safe' },
        hooks: { http: false, views: false, sockets: false, pubsub: false, grunt: false },
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

      for (const [attrName, attr] of Object.entries(model.attributes)) {
        const schemaAttr = model.schema?.[attrName] || {};
        const columnName = schemaAttr.columnName || attr.columnName || attrName;

        // Skip associations for now
        if (attr.collection || attr.model) continue;

        models[identity].attributes[attrName] = {
          type: attr.type,
          columnType:
            attr.columnType ||
            schemaAttr.columnType ||
            attr.autoMigrations?.columnType ||
            schemaAttr.autoMigrations?.columnType,
          columnName,
          required: attr.required || false,
          unique: attr.unique || false,
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

function executeInContainer(containerName, code) {
  return new Promise((resolve) => {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const proc = spawn(dockerPath, ['exec', '-i', containerName, 'node'], {
      timeout: 60000 // 1 minute timeout
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
