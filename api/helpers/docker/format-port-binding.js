module.exports = {
  friendlyName: 'Format port binding',

  description: 'Build the Docker publish argument for an application port.',

  inputs: {
    host: {
      type: 'string',
      defaultsTo: '0.0.0.0',
      description: 'Host interface that should receive the published port.'
    },
    hostPort: {
      type: 'number',
      required: true,
      description: 'Port exposed on the host.'
    },
    containerPort: {
      type: 'number',
      required: true,
      description: 'Port exposed by the container.'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ host, hostPort, containerPort }) {
    const bindHost = String(host || '0.0.0.0').trim() || '0.0.0.0'

    return bindHost === '0.0.0.0'
      ? `${hostPort}:${containerPort}`
      : `${bindHost}:${hostPort}:${containerPort}`
  }
}
