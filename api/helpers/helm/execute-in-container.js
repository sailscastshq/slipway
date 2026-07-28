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
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, source }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    return sails.helpers.helm.run.with({
      command: dockerPath,
      args: ['exec', '-i', containerName, 'node'],
      source,
      bootstrapSails: true
    })
  }
}
