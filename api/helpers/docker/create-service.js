const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

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
    const service = await Service.findOne({ id: serviceId })
    if (!service) {
      throw new Error('Service not found')
    }

    const networkName = sails.config.custom.slipwayNetwork || 'slipway'
    const image = Service.getDockerImage(service.type, service.version)

    // Build docker run command based on service type
    let cmd = `docker run -d --name ${service.containerName} --network ${networkName}`
    cmd += ' --restart unless-stopped'

    // Add service-specific environment variables
    switch (service.type) {
      case 'postgresql':
        cmd += ` -e POSTGRES_USER=${service.username}`
        cmd += ` -e POSTGRES_PASSWORD=${service.password}`
        cmd += ` -e POSTGRES_DB=${service.database}`
        break

      case 'mysql':
        cmd += ` -e MYSQL_ROOT_PASSWORD=${service.password}`
        cmd += ` -e MYSQL_USER=${service.username}`
        cmd += ` -e MYSQL_PASSWORD=${service.password}`
        cmd += ` -e MYSQL_DATABASE=${service.database}`
        break

      case 'redis':
        if (service.password) {
          cmd += ` ${image} redis-server --requirepass ${service.password}`
          // Return early to avoid adding image twice
          sails.log.info(`Creating Redis service: ${service.containerName}`)
          try {
            const { stdout } = await execAsync(cmd)
            const containerId = stdout.trim()

            await Service.updateOne({ id: serviceId }).set({
              containerId,
              status: 'running'
            })

            sails.log.info(`Redis service started: ${service.containerName}`)
            return { containerId, containerName: service.containerName }
          } catch (error) {
            await Service.updateOne({ id: serviceId }).set({ status: 'failed' })
            throw 'createFailed'
          }
        }
        break

      case 'mongodb':
        cmd += ` -e MONGO_INITDB_ROOT_USERNAME=${service.username}`
        cmd += ` -e MONGO_INITDB_ROOT_PASSWORD=${service.password}`
        cmd += ` -e MONGO_INITDB_DATABASE=${service.database}`
        break
    }

    cmd += ` ${image}`

    sails.log.info(`Creating ${service.type} service: ${service.containerName}`)
    sails.log.verbose(`Command: ${cmd}`)

    try {
      const { stdout } = await execAsync(cmd)
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
      await Service.updateOne({ id: serviceId }).set({ status: 'failed' })
      throw 'createFailed'
    }
  }
}
