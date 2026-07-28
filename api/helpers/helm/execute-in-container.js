module.exports = {
  friendlyName: 'Execute Helm in container',

  description:
    'Evaluate JavaScript inside a running app container through the shared Helm runtime.',

  inputs: {
    containerName: {
      type: 'string',
      required: true
    },
    source: {
      type: 'string',
      required: true
    },
    sourceStartLine: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    },
    sourceStartColumn: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    containerName,
    source,
    sourceStartLine,
    sourceStartColumn
  }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    return sails.helpers.helm.run.with({
      command: dockerPath,
      args: ['exec', '-i', containerName, 'node'],
      source,
      sourceStartLine,
      sourceStartColumn,
      bootstrapSails: true
    })
  }
}
