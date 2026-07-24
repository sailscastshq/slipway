const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Wait for service',

  description: 'Wait until a newly created service container accepts commands.',

  inputs: {
    service: {
      type: 'ref',
      required: true
    },
    containerName: {
      type: 'string',
      required: true
    },
    attempts: {
      type: 'number',
      defaultsTo: 60
    },
    intervalMs: {
      type: 'number',
      defaultsTo: 1000
    }
  },

  fn: async function ({ service, containerName, attempts, intervalMs }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const command = getReadinessCommand(service, containerName)
    let lastError

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await execFileAsync(dockerPath, command, {
          timeout: 10000,
          maxBuffer: 64 * 1024
        })
        return { ready: true, attempts: attempt }
      } catch (error) {
        lastError = error
        if (attempt < attempts) await delay(intervalMs)
      }
    }

    const error = new Error(
      `${service.type} did not become ready after ${attempts} attempts: ${
        lastError?.stderr || lastError?.message || 'readiness check failed'
      }`
    )
    error.code = 'SERVICE_NOT_READY'
    throw error
  }
}

function getReadinessCommand(service, containerName) {
  switch (service.type) {
    case 'postgresql':
      return [
        'exec',
        containerName,
        'pg_isready',
        '-U',
        service.username,
        '-d',
        service.database
      ]
    case 'mysql':
      return [
        'exec',
        containerName,
        'mysqladmin',
        'ping',
        '-u',
        'root',
        `-p${service.password}`,
        '--silent'
      ]
    case 'mongodb':
      return [
        'exec',
        containerName,
        'mongosh',
        '--quiet',
        '--username',
        service.username,
        '--password',
        service.password,
        '--authenticationDatabase',
        'admin',
        '--eval',
        'quit(db.adminCommand({ ping: 1 }).ok ? 0 : 1)'
      ]
    case 'redis':
      return [
        'exec',
        containerName,
        'redis-cli',
        ...(service.password ? ['-a', service.password] : []),
        'ping'
      ]
    default:
      throw new Error(`Unsupported service type: ${service.type}`)
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}
