const { execFile } = require('child_process')

module.exports = {
  friendlyName: 'Caddy request',

  description:
    'Make an HTTP request to the Caddy admin API. ' +
    'caddy-docker-proxy locks admin to localhost:2019 and has no shell, ' +
    'so we run a temporary Alpine container sharing its network namespace.',

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
    const baseUrl = 'http://localhost:2019'

    // Spin up a temporary Alpine container that shares slipway-proxy's network
    // namespace. localhost:2019 inside it reaches the Caddy admin API.
    return new Promise((resolve, reject) => {
      let cmd

      if (method === 'GET') {
        cmd = `wget -q -O- '${baseUrl}${path}'`
      } else if (method === 'POST') {
        const json = data ? JSON.stringify(data) : ''
        const escaped = json.replace(/'/g, "'\\''")
        cmd = `wget -q -O- --header='Content-Type: application/json' --post-data='${escaped}' '${baseUrl}${path}'`
      } else if (method === 'DELETE') {
        cmd = `printf 'DELETE ${path} HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' | nc -w 5 localhost 2019`
      }

      execFile(
        dockerPath,
        ['run', '--rm', '--network', 'container:slipway-proxy', 'alpine', 'sh', '-c', cmd],
        (err, stdout) => {
          if (err) {
            return reject(err)
          }
          resolve(stdout)
        }
      )
    })
  }
}
