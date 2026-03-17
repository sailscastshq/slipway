const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Execute in container',

  description:
    'Execute JavaScript code inside a running app container for Quest operations.',

  inputs: {
    containerName: {
      type: 'string',
      required: true,
      description: 'Docker container name of the running app'
    },
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to execute'
    },
    timeout: {
      type: 'number',
      defaultsTo: 30000,
      description: 'Timeout in milliseconds'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerName, code, timeout }) {
    return new Promise((resolve) => {
      const dockerPath = sails.config.docker?.binaryPath || 'docker'
      const proc = spawn(dockerPath, ['exec', '-i', containerName, 'node'], {
        timeout
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
}
