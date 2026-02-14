const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Caddy request',

  description:
    'Make an HTTP request to the Caddy admin API via docker exec. ' +
    'caddy-docker-proxy locks admin to localhost:2019 inside its container, ' +
    'so we exec into slipway-proxy to reach it.',

  inputs: {
    method: {
      type: 'string',
      required: true,
      isIn: ['GET', 'POST', 'DELETE']
    },
    path: {
      type: 'string',
      required: true
    },
    data: {
      type: 'ref',
      description: 'Request body object (for POST). Will be JSON-stringified.'
    }
  },

  exits: {
    success: {
      description: 'Request completed successfully.'
    },
    requestFailed: {
      description: 'The Caddy admin API request failed.'
    }
  },

  fn: async function ({ method, path, data }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const container = 'slipway-proxy'
    const baseUrl = 'http://localhost:2019'

    // All methods use sh -c so arguments are properly quoted inside the container
    return new Promise((resolve, reject) => {
      let cmd

      if (method === 'GET') {
        cmd = `wget -q -O- '${baseUrl}${path}'`
      } else if (method === 'POST') {
        const json = data ? JSON.stringify(data) : ''
        // Escape single quotes in JSON for safe shell embedding
        const escaped = json.replace(/'/g, "'\\''")
        cmd = `wget -q -O- --header='Content-Type: application/json' --post-data='${escaped}' '${baseUrl}${path}'`
      } else if (method === 'DELETE') {
        // BusyBox wget does not support custom methods — use printf + nc
        cmd = `printf 'DELETE ${path} HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' | nc -w 5 localhost 2019`
      }

      execFile(dockerPath, ['exec', container, 'sh', '-c', cmd], (err, stdout) => {
        if (err) {
          return reject(err)
        }
        resolve(stdout)
      })
    })
  }
}
