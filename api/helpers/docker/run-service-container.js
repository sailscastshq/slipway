const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = {
  friendlyName: 'Run service container',

  description:
    'Launch a service container from an immutable image reference and an explicit data volume.',

  inputs: {
    service: {
      type: 'ref',
      required: true
    },
    containerName: {
      type: 'string',
      required: true
    },
    imageReference: {
      type: 'string',
      required: true
    },
    volumeName: {
      type: 'string',
      required: true
    }
  },

  fn: async function ({ service, containerName, imageReference, volumeName }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const networkName = sails.config.custom.slipwayNetwork || 'slipway'
    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      networkName,
      '--restart',
      'unless-stopped'
    ]

    const dataDirs = {
      postgresql: '/var/lib/postgresql',
      mysql: '/var/lib/mysql',
      mongodb: '/data/db',
      redis: '/data'
    }
    const dataDir = dataDirs[service.type]
    if (dataDir) args.push('-v', `${volumeName}:${dataDir}`)

    const typeDefaults = {
      postgresql: { cpus: '1', memory: '512m' },
      mysql: { cpus: '1', memory: '512m' },
      mongodb: { cpus: '1', memory: '512m' },
      redis: { cpus: '0.25', memory: '128m' }
    }
    const resourceLimits = service.resourceLimits ||
      typeDefaults[service.type] || { cpus: '0.5', memory: '256m' }

    if (resourceLimits.cpus) {
      args.push('--cpus', String(resourceLimits.cpus))
    }
    if (resourceLimits.memory) {
      args.push('--memory', String(resourceLimits.memory))
      args.push('--memory-swap', '-1')
    }

    switch (service.type) {
      case 'postgresql':
        args.push('-e', `POSTGRES_USER=${service.username}`)
        args.push('-e', `POSTGRES_PASSWORD=${service.password}`)
        args.push('-e', `POSTGRES_DB=${service.database}`)
        args.push('-e', 'PGDATA=/var/lib/postgresql/data')
        break
      case 'mysql':
        args.push('-e', `MYSQL_ROOT_PASSWORD=${service.password}`)
        args.push('-e', `MYSQL_USER=${service.username}`)
        args.push('-e', `MYSQL_PASSWORD=${service.password}`)
        args.push('-e', `MYSQL_DATABASE=${service.database}`)
        break
      case 'mongodb':
        args.push('-e', `MONGO_INITDB_ROOT_USERNAME=${service.username}`)
        args.push('-e', `MONGO_INITDB_ROOT_PASSWORD=${service.password}`)
        args.push('-e', `MONGO_INITDB_DATABASE=${service.database}`)
        break
    }

    args.push(imageReference)
    if (service.type === 'redis' && service.password) {
      args.push('redis-server', '--requirepass', service.password)
    }

    const { stdout } = await execFileAsync(dockerPath, args, {
      timeout: 300000,
      maxBuffer: 1024 * 1024
    })

    return {
      containerId: stdout.trim(),
      containerName,
      volumeName,
      imageReference
    }
  }
}
