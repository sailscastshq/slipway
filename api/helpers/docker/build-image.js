const { spawn } = require('child_process')
const path = require('path')
const deploymentCancellation = require('../../lib/deployment-cancellation')

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
      description:
        'Name and tag for the image (e.g., slipway/myapp-production:latest)'
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
      description:
        'Disable Docker layer caching (slower but ensures fresh build)'
    },
    signal: {
      type: 'ref',
      description: 'Abort signal for an operator-requested cancellation.'
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

  fn: async function ({
    contextPath,
    imageName,
    dockerfilePath,
    deploymentId,
    buildArgs,
    timeout,
    noCache,
    signal
  }) {
    deploymentCancellation.throwIfCancelled(signal, deploymentId)

    return new Promise((resolve, reject) => {
      const dockerPath = sails.config.docker?.binaryPath || 'docker'
      const fullDockerfilePath = path.resolve(contextPath, dockerfilePath)
      const args = [
        'build',
        '--progress=plain',
        '-t',
        imageName,
        '-f',
        fullDockerfilePath
      ]

      // Only disable cache if explicitly requested
      if (noCache) {
        args.push('--no-cache')
      }

      // Add build args
      for (const [key, value] of Object.entries(buildArgs)) {
        args.push('--build-arg', `${key}=${value}`)
      }

      args.push(contextPath)

      sails.log.info(`Building image: ${imageName}`)

      const buildProcess = spawn(dockerPath, args, {
        env: { ...process.env, DOCKER_BUILDKIT: '1' }
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      let terminationError = null
      let forceKillId

      const cleanup = () => {
        clearTimeout(timeoutId)
        clearTimeout(forceKillId)
        signal?.removeEventListener('abort', abort)
      }

      const settle = (done, value) => {
        if (settled) return
        settled = true
        cleanup()
        done(value)
      }

      const terminate = (error) => {
        if (terminationError || settled) return
        terminationError = error

        try {
          buildProcess.kill('SIGTERM')
        } catch {
          // The process may have exited between the cancellation and signal.
        }

        forceKillId = setTimeout(() => {
          if (buildProcess.exitCode === null) {
            try {
              buildProcess.kill('SIGKILL')
            } catch {
              // The process has already stopped.
            }
          }
        }, 5000)
        if (typeof forceKillId.unref === 'function') forceKillId.unref()
      }

      const abort = () => {
        terminate(
          deploymentCancellation.cancellationError(signal, deploymentId)
        )
      }

      // Set up timeout
      const timeoutId = setTimeout(() => {
        const timeoutMinutes = Math.round(timeout / 60000)
        const errorMsg = `Build timed out after ${timeoutMinutes} minutes`
        sails.log.error(errorMsg)

        if (deploymentId) {
          Deployment.appendBuildLog(deploymentId, `\n⚠️ ${errorMsg}\n`).catch(
            () => {}
          )
        }
        terminate(new Error(errorMsg))
      }, timeout)

      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()

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
        if (terminationError) {
          settle(reject, terminationError)
          return
        }

        if (code === 0) {
          sails.log.info(`Successfully built image: ${imageName}`)
          settle(resolve, {
            success: true,
            imageName,
            output: stdout
          })
        } else {
          sails.log.error(`Docker build failed with code ${code}`)
          settle(
            reject,
            new Error(`Docker build failed with exit code ${code}\n${stderr}`)
          )
        }
      })

      buildProcess.on('error', async (error) => {
        const failure = terminationError || error
        if (!terminationError) {
          sails.log.error(`Docker build error: ${error.message}`)
        }
        settle(reject, failure)
      })
    })
  }
}
