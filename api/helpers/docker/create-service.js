const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Create service',

  description: 'Create a backing service container (PostgreSQL, MySQL, Redis, MongoDB).',

  inputs: {
    serviceId: {
      type: 'string',
      required: true,
      description: 'Service record ID'
    }
  },

  exits: {
    success: {
      description: 'Service container is running',
      outputType: 'ref'
    },
    createFailed: {
      description: 'Failed to create service container'
    }
  },

  fn: async function ({ serviceId }) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (!service) {
      throw new Error('Service not found')
    }

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const networkName = sails.config.custom.slipwayNetwork || 'slipway'
    const image = Service.getDockerImage(service.type, service.version)

    // Build docker run args based on service type
    const args = ['run', '-d', '--name', service.containerName, '--network', networkName, '--restart', 'unless-stopped']

    // Add resource limits (per-type defaults for databases vs Redis)
    const typeDefaults = {
      postgresql: { cpus: '1', memory: '512m' },
      mysql: { cpus: '1', memory: '512m' },
      mongodb: { cpus: '1', memory: '512m' },
      redis: { cpus: '0.25', memory: '128m' }
    }
    const resourceLimits = service.resourceLimits || typeDefaults[service.type] || { cpus: '0.5', memory: '256m' }
    if (resourceLimits.cpus) {
      args.push('--cpus', String(resourceLimits.cpus))
    }
    if (resourceLimits.memory) {
      args.push('--memory', String(resourceLimits.memory))
      args.push('--memory-swap', '-1')
    }

    // Add service-specific environment variables
    switch (service.type) {
      case 'postgresql':
        args.push('-e', `POSTGRES_USER=${service.username}`)
        args.push('-e', `POSTGRES_PASSWORD=${service.password}`)
        args.push('-e', `POSTGRES_DB=${service.database}`)
        break

      case 'mysql':
        args.push('-e', `MYSQL_ROOT_PASSWORD=${service.password}`)
        args.push('-e', `MYSQL_USER=${service.username}`)
        args.push('-e', `MYSQL_PASSWORD=${service.password}`)
        args.push('-e', `MYSQL_DATABASE=${service.database}`)
        break

      case 'redis':
        // Redis needs the image first, then the command
        args.push(image)
        if (service.password) {
          args.push('redis-server', '--requirepass', service.password)
        }
        break

      case 'mongodb':
        args.push('-e', `MONGO_INITDB_ROOT_USERNAME=${service.username}`)
        args.push('-e', `MONGO_INITDB_ROOT_PASSWORD=${service.password}`)
        args.push('-e', `MONGO_INITDB_DATABASE=${service.database}`)
        break
    }

    // Add image at the end (unless redis already added it)
    if (service.type !== 'redis') {
      args.push(image)
    }

    sails.log.info(`Creating ${service.type} service: ${service.containerName}`)
    sails.log.verbose(`Command: docker ${args.join(' ')}`)

    try {
      const { stdout } = await execFileAsync(dockerPath, args, {
        timeout: 300000 // 5 minute timeout for image pulls
      })
      const containerId = stdout.trim()

      await Service.updateOne({ id: serviceId }).set({
        containerId,
        status: 'running'
      })

      sails.log.info(`Service started: ${service.containerName} (${containerId.substring(0, 12)})`)

      return {
        containerId,
        containerName: service.containerName,
        type: service.type
      }
    } catch (error) {
      sails.log.error(`Failed to create service: ${error.message}`)
      if (error.stderr) {
        sails.log.error(`stderr: ${error.stderr}`)
      }
      await Service.updateOne({ id: serviceId }).set({ status: 'failed' })
      throw 'createFailed'
    }
  }
}
