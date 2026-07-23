const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)
const deploymentCancellation = require('../../lib/deployment-cancellation')

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
    host: {
      type: 'string',
      description:
        'Host interface to bind. Defaults to the Slipway host bind address.'
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
    },
    resourceLimits: {
      type: 'ref',
      defaultsTo: {},
      description: 'Docker resource limits (cpus, memory)'
    },
    signal: {
      type: 'ref',
      description: 'Abort signal for an operator-requested cancellation.'
    }
  },

  exits: {
    success: {
      description: 'Container is running',
      outputType: 'ref'
    }
  },

  fn: async function ({
    imageName,
    containerName,
    port,
    hostPort,
    host,
    envVars,
    network,
    deploymentId,
    resourceLimits,
    signal
  }) {
    deploymentCancellation.throwIfCancelled(signal, deploymentId)
    const networkName =
      network || sails.config.custom.slipwayNetwork || 'slipway'
    const bindHost = normalizeHost(
      host || sails.config.custom.slipwayPortHost || '0.0.0.0'
    )
    const portBindingArgument =
      await sails.helpers.docker.formatPortBinding.with({
        host: bindHost,
        hostPort,
        containerPort: port
      })
    const dockerPath = sails.config.docker?.binaryPath || 'docker'

    // Build docker run args array (no shell — safe from injection)
    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '--network',
      networkName,
      '-p',
      portBindingArgument
    ]

    // Add environment variables
    for (const [key, value] of Object.entries(envVars)) {
      args.push('-e', key + '=' + value)
    }

    // Add resource limits
    if (resourceLimits && resourceLimits.cpus) {
      args.push('--cpus', String(resourceLimits.cpus))
    }
    if (resourceLimits && resourceLimits.memory) {
      args.push('--memory', String(resourceLimits.memory))
      args.push('--memory-swap', '-1')
    }

    // Add restart policy
    args.push('--restart', 'unless-stopped')

    // Add image name
    args.push(imageName)

    sails.log.info(`Running container: ${containerName}`)
    sails.log.verbose(`Command: docker ${args.join(' ')}`)

    if (deploymentId) {
      await Deployment.appendDeployLog(
        deploymentId,
        `Starting container: ${containerName}\n`
      )
    }

    try {
      const { stdout } = await execFileAsync(dockerPath, args, { signal })
      deploymentCancellation.throwIfCancelled(signal, deploymentId)
      const containerId = stdout.trim()

      sails.log.info(
        `Container started: ${containerName} (${containerId.substring(0, 12)})`
      )

      if (deploymentId) {
        await Deployment.appendDeployLog(
          deploymentId,
          `Container started: ${containerId.substring(0, 12)}\n`
        )
      }

      const portBinding = await sails.helpers.docker.getPortBinding.with({
        containerName,
        containerPort: port,
        hostPort,
        host: bindHost
      })
      deploymentCancellation.throwIfCancelled(signal, deploymentId)

      if (!portBinding.valid) {
        throw new Error(
          `Host binding verification failed: ${portBinding.diagnostic}`
        )
      }

      if (deploymentId) {
        await Deployment.appendDeployLog(
          deploymentId,
          `Host binding verified: ${portBinding.host}:${hostPort} -> ${port}/tcp\n`
        )
      }

      return {
        containerId,
        containerName,
        hostPort,
        network: networkName,
        portBinding
      }
    } catch (error) {
      if (signal?.aborted) {
        throw deploymentCancellation.cancellationError(signal, deploymentId)
      }
      const errorMessage = error.message || String(error)
      sails.log.error(`Failed to run container: ${errorMessage}`)

      if (deploymentId) {
        await Deployment.appendDeployLog(
          deploymentId,
          `Container startup or host binding failed: ${errorMessage}\n`
        )
      }

      throw error
    }
  }
}

function normalizeHost(host) {
  return String(host || '0.0.0.0').trim() || '0.0.0.0'
}
