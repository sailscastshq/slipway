const { spawn } = require('child_process')
const path = require('path')

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
    },
    timeout: {
      type: 'number',
      defaultsTo: 600000, // 10 minutes default
      description: 'Build timeout in milliseconds'
    },
    noCache: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Disable Docker layer caching (slower but ensures fresh build)'
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

  fn: async function ({ contextPath, imageName, dockerfilePath, deploymentId, buildArgs, timeout, noCache }) {
    return new Promise((resolve, reject) => {
      const dockerPath = sails.config.docker?.binaryPath || 'docker'
      const fullDockerfilePath = path.resolve(contextPath, dockerfilePath)
      const args = ['build', '--progress=plain', '-t', imageName, '-f', fullDockerfilePath]

      // Only disable cache if explicitly requested
      if (noCache) {
        args.push('--no-cache')
      }

      // Add build args
      for (const [key, value] of Object.entries(buildArgs)) {
        args.push('--build-arg', `${key}=${value}`)
      }

      args.push(contextPath)

      sails.log.info(`Building image: ${dockerPath} ${args.join(' ')}`)

      const buildProcess = spawn(dockerPath, args, {
        env: { ...process.env, DOCKER_BUILDKIT: '1' }
      })
      let stdout = ''
      let stderr = ''
      let killed = false

      // Set up timeout
      const timeoutId = setTimeout(async () => {
        killed = true
        buildProcess.kill('SIGTERM')

        // Give it 5 seconds to terminate gracefully, then force kill
        setTimeout(() => {
          if (!buildProcess.killed) {
            buildProcess.kill('SIGKILL')
          }
        }, 5000)

        const timeoutMinutes = Math.round(timeout / 60000)
        const errorMsg = `Build timed out after ${timeoutMinutes} minutes`
        sails.log.error(errorMsg)

        if (deploymentId) {
          await Deployment.appendBuildLog(deploymentId, `\n⚠️ ${errorMsg}\n`)
          await Deployment.updateOne({ id: deploymentId }).set({
            status: 'failed',
            errorMessage: errorMsg,
            finishedAt: Date.now()
          })
        }
        reject(new Error(errorMsg))
      }, timeout)

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
        clearTimeout(timeoutId)

        if (killed) return // Already handled by timeout

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
        clearTimeout(timeoutId)

        if (killed) return // Already handled by timeout

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
