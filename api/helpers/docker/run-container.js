const { exec } = require('child_process')
const util = require('util')
const execAsync = util.promisify(exec)

module.exports = {
  friendlyName: 'Run container',

  description: 'Run a Docker container from an image.',

  inputs: {
    imageName: {
      type: 'string',
      required: true,
      description: 'Docker image name:tag'
    },
    containerName: {
      type: 'string',
      required: true,
      description: 'Name for the container'
    },
    port: {
      type: 'number',
      required: true,
      description: 'Internal port the app listens on'
    },
    hostPort: {
      type: 'number',
      required: true,
      description: 'Host port to map to'
    },
    envVars: {
      type: 'ref',
      defaultsTo: {},
      description: 'Environment variables for the container'
    },
    network: {
      type: 'string',
      description: 'Docker network to join'
    },
    deploymentId: {
      type: 'string',
      description: 'Deployment ID to stream logs to'
    }
  },

  exits: {
    success: {
      description: 'Container is running',
      outputType: 'ref'
    },
    runFailed: {
      description: 'Failed to run container'
    }
  },

  fn: async function ({ imageName, containerName, port, hostPort, envVars, network, deploymentId }) {
    const networkName = network || sails.config.custom.slipwayNetwork || 'slipway'

    // Stop and remove existing container if it exists
    try {
      await execAsync(`docker stop ${containerName}`)
      await execAsync(`docker rm ${containerName}`)
      sails.log.verbose(`Removed existing container: ${containerName}`)
    } catch {
      // Container doesn't exist, that's fine
    }

    // Build docker run command
    let cmd = `docker run -d --name ${containerName} --network ${networkName}`
    cmd += ` -p ${hostPort}:${port}`

    // Add environment variables
    for (const [key, value] of Object.entries(envVars)) {
      // Escape values for shell
      const escapedValue = value.toString().replace(/'/g, "'\\''")
      cmd += ` -e '${key}=${escapedValue}'`
    }

    // Add restart policy
    cmd += ' --restart unless-stopped'

    // Add image name
    cmd += ` ${imageName}`

    sails.log.info(`Running container: ${containerName}`)
    sails.log.verbose(`Command: ${cmd}`)

    if (deploymentId) {
      await Deployment.appendDeployLog(deploymentId, `Starting container: ${containerName}\n`)
    }

    try {
      const { stdout } = await execAsync(cmd)
      const containerId = stdout.trim()

      sails.log.info(`Container started: ${containerName} (${containerId.substring(0, 12)})`)

      if (deploymentId) {
        await Deployment.appendDeployLog(deploymentId, `Container started: ${containerId.substring(0, 12)}\n`)
      }

      return {
        containerId,
        containerName,
        hostPort,
        network: networkName
      }
    } catch (error) {
      sails.log.error(`Failed to run container: ${error.message}`)

      if (deploymentId) {
        await Deployment.appendDeployLog(deploymentId, `Error: ${error.message}\n`)
        await Deployment.updateOne({ id: deploymentId }).set({
          status: 'failed',
          errorMessage: error.message,
          finishedAt: Date.now()
        })
      }

      throw 'runFailed'
    }
  }
}
