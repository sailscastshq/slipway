const { spawn } = require('child_process')

// Markers used to isolate JSON output from console noise
const START_MARKER = '___SLIPWAY_BRIDGE_START___'
const END_MARKER = '___SLIPWAY_BRIDGE_END___'

module.exports = {
  friendlyName: 'Execute in container',

  description: 'Execute JavaScript code inside a running app container and return the result.',

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
      defaultsTo: 60000,
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
        // Extract JSON between markers to filter out any console noise
        let output = stdout.trim()
        const startIdx = output.indexOf(START_MARKER)
        const endIdx = output.indexOf(END_MARKER)

        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          output = output.substring(startIdx + START_MARKER.length, endIdx)
        }

        resolve({
          success: exitCode === 0,
          output,
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
