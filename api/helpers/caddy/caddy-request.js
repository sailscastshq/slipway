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

    return new Promise((resolve, reject) => {
      if (method === 'GET' || method === 'POST') {
        const args = ['exec', container, 'wget', '-q', '-O-']

        if (method === 'POST') {
          args.push('--header=Content-Type: application/json')
          args.push('--post-data=' + (data ? JSON.stringify(data) : ''))
        }

        args.push('http://localhost:2019' + path)

        execFile(dockerPath, args, (err, stdout) => {
          if (err) {
            return reject(err)
          }
          resolve(stdout)
        })
      } else if (method === 'DELETE') {
        // BusyBox wget does not support custom methods — use printf + nc
        const raw = [
          `DELETE ${path} HTTP/1.1`,
          'Host: localhost',
          'Connection: close',
          '',
          ''
        ].join('\\r\\n')

        execFile(
          dockerPath,
          ['exec', container, 'sh', '-c', `printf '${raw}' | nc -w 5 localhost 2019`],
          (err, stdout) => {
            if (err) {
              return reject(err)
            }
            resolve(stdout)
          }
        )
      }
    })
  }
}
