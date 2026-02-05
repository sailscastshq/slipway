const { spawn } = require('child_process')

module.exports = {
  friendlyName: 'Build image',

  description: 'Build a Docker image from a Dockerfile.',

  inputs: {
    contextPath: {
      type: 'string',
      required: true,
      description: 'Path to the build context (directory with Dockerfile)'
    },
    imageName: {
      type: 'string',
      required: true,
      description: 'Name and tag for the image (e.g., slipway/myapp-production:latest)'
    },
    dockerfilePath: {
      type: 'string',
      defaultsTo: 'Dockerfile',
      description: 'Path to Dockerfile relative to context'
    },
    deploymentId: {
      type: 'string',
      description: 'Deployment ID to stream logs to'
    },
    buildArgs: {
      type: 'ref',
      defaultsTo: {},
      description: 'Build arguments to pass to Docker'
    }
  },

  exits: {
    success: {
      description: 'Image was built successfully',
      outputType: 'ref'
    },
    buildFailed: {
      description: 'Docker build failed'
    }
  },

  fn: async function ({ contextPath, imageName, dockerfilePath, deploymentId, buildArgs }) {
    return new Promise((resolve, reject) => {
      const args = ['build', '--no-cache', '-t', imageName, '-f', dockerfilePath]

      // Add build args
      for (const [key, value] of Object.entries(buildArgs)) {
        args.push('--build-arg', `${key}=${value}`)
      }

      args.push(contextPath)

      sails.log.info(`Building image: docker ${args.join(' ')}`)

      const buildProcess = spawn('docker', args)
      let stdout = ''
      let stderr = ''

      buildProcess.stdout.on('data', async (data) => {
        const chunk = data.toString()
        stdout += chunk
        sails.log.verbose(chunk)

        // Stream to deployment logs if provided
        if (deploymentId) {
          await Deployment.appendBuildLog(deploymentId, chunk)
        }
      })

      buildProcess.stderr.on('data', async (data) => {
        const chunk = data.toString()
        stderr += chunk
        // Docker outputs progress to stderr, so log as verbose
        sails.log.verbose(chunk)

        if (deploymentId) {
          await Deployment.appendBuildLog(deploymentId, chunk)
        }
      })

      buildProcess.on('close', async (code) => {
        if (code === 0) {
          sails.log.info(`Successfully built image: ${imageName}`)
          resolve({
            success: true,
            imageName,
            output: stdout
          })
        } else {
          sails.log.error(`Docker build failed with code ${code}`)
          if (deploymentId) {
            await Deployment.updateOne({ id: deploymentId }).set({
              status: 'failed',
              errorMessage: `Build failed with exit code ${code}`,
              finishedAt: Date.now()
            })
          }
          reject(new Error(`Docker build failed with exit code ${code}\n${stderr}`))
        }
      })

      buildProcess.on('error', async (error) => {
        sails.log.error(`Docker build error: ${error.message}`)
        if (deploymentId) {
          await Deployment.updateOne({ id: deploymentId }).set({
            status: 'failed',
            errorMessage: error.message,
            finishedAt: Date.now()
          })
        }
        reject(error)
      })
    })
  }
}
