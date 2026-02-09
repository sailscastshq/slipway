const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Execute Redis command',

  description: 'Execute a Redis command against a Redis service via docker exec.',

  inputs: {
    service: {
      type: 'ref',
      required: true,
      description: 'Redis service object (must have containerName, password, internalPort)'
    },
    command: {
      type: 'string',
      required: true,
      description: 'Redis command to execute (e.g. "GET mykey", "SET foo bar")'
    }
  },

  exits: {
    success: {
      description: 'Command executed successfully',
      outputType: 'ref'
    }
  },

  fn: async function ({ service, command }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const startTime = Date.now()

    // Build redis-cli args — pass command as a single string via sh -c
    // so redis-cli can parse it naturally (handles quoted strings, etc.)
    const redisCliCmd = [
      'redis-cli',
      '-p', String(service.internalPort),
      ...(service.password ? ['-a', service.password, '--no-auth-warning'] : []),
      ...tokenizeRedisCommand(command)
    ]

    const args = ['exec', service.containerName, ...redisCliCmd]

    try {
      sails.log.verbose(`[redis] Executing command on ${service.containerName}`)

      const { stdout, stderr } = await execFileAsync(dockerPath, args, {
        timeout: 10000,
        maxBuffer: 5 * 1024 * 1024
      })

      return {
        success: true,
        output: stdout.trimEnd(),
        error: stderr ? stderr.trim() : null,
        duration: Date.now() - startTime
      }
    } catch (error) {
      sails.log.error(`[redis] Command execution failed: ${error.message}`)

      let errorMessage = error.message
      if (error.stderr) {
        errorMessage = error.stderr.trim()
      }

      return {
        success: false,
        output: '',
        error: errorMessage,
        duration: Date.now() - startTime
      }
    }
  }
}

/**
 * Tokenize a Redis command string into arguments.
 * Handles quoted strings: SET key "hello world" -> ['SET', 'key', 'hello world']
 */
function tokenizeRedisCommand(command) {
  const tokens = []
  let current = ''
  let inDoubleQuote = false
  let inSingleQuote = false

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote
    } else if (ch === '\'' && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote
    } else if (ch === ' ' && !inDoubleQuote && !inSingleQuote) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }

  if (current.length > 0) {
    tokens.push(current)
  }

  return tokens
}
