const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Apply update',

  description:
    'Pull the latest Slipway Docker image and restart the container with the new version.',

  inputs: {},

  exits: {
    success: {
      description: 'Update initiated successfully.'
    },
    noUpdate: {
      description: 'Already running the latest version.',
      responseType: 'badRequest'
    },
    pullFailed: {
      description: 'Failed to pull the new image.',
      responseType: 'serverError'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const image = 'ghcr.io/sailscastshq/slipway'

    // 1. Check that an update is actually available
    const updateInfo = await sails.helpers.system.checkForUpdates()
    if (!updateInfo.updateAvailable) {
      throw 'noUpdate'
    }

    const pullTarget = `${image}:latest`

    // 2. Pull the latest image
    sails.log.info(`[slipway] Pulling ${pullTarget}...`)
    try {
      await execFileAsync(dockerPath, ['pull', pullTarget], {
        timeout: 300000
      }) // 5 min timeout for slow connections
    } catch (err) {
      sails.log.error(`[slipway] Failed to pull image: ${err.message}`)
      throw 'pullFailed'
    }
    sails.log.info('[slipway] Image pulled successfully')

    // 3. Inspect current container to reconstruct its config
    let containerInfo
    try {
      const { stdout } = await execFileAsync(dockerPath, [
        'inspect',
        'slipway'
      ])
      containerInfo = JSON.parse(stdout)[0]
    } catch (err) {
      sails.log.error(
        `[slipway] Failed to inspect container: ${err.message}`
      )
      throw 'pullFailed'
    }

    // 4. Build docker run arguments from current container config
    const runArgs = [
      'run',
      '-d',
      '--name',
      'slipway',
      '--restart',
      'unless-stopped'
    ]

    // Network
    const networks = Object.keys(
      containerInfo.NetworkSettings?.Networks || {}
    )
    if (networks.length > 0) {
      runArgs.push('--network', networks[0])
    }

    // Volumes
    for (const mount of containerInfo.Mounts || []) {
      if (mount.Type === 'volume') {
        runArgs.push('-v', `${mount.Name}:${mount.Destination}`)
      } else if (mount.Type === 'bind') {
        const readOnly = mount.RW === false ? ':ro' : ''
        runArgs.push(
          '-v',
          `${mount.Source}:${mount.Destination}${readOnly}`
        )
      }
    }

    // Environment variables
    for (const envVar of containerInfo.Config?.Env || []) {
      runArgs.push('-e', envVar)
    }

    // Labels (skip internal Docker labels)
    for (const [key, value] of Object.entries(
      containerInfo.Config?.Labels || {}
    )) {
      // Skip Docker-internal and image metadata labels
      if (
        key.startsWith('org.opencontainers.') ||
        key.startsWith('com.docker.')
      ) {
        continue
      }
      runArgs.push('-l', `${key}=${value}`)
    }

    // Image (always use latest)
    runArgs.push(pullTarget)

    // 5. Spawn the bosun — a detached sidecar container that performs the swap
    // Uses Node.js + execFileSync to avoid shell injection entirely
    const argsJson = JSON.stringify(runArgs)
    const script =
      'const{execFileSync}=require("child_process");' +
      'setTimeout(()=>{' +
      'try{' +
      'console.log("Stopping old Slipway container...");' +
      'execFileSync("docker",["rm","-f","slipway"]);' +
      'console.log("Starting new Slipway container...");' +
      'execFileSync("docker",' +
      argsJson +
      ');' +
      'console.log("Update complete!");' +
      '}catch(e){' +
      'console.error("Update failed:",e.message);' +
      'process.exit(1)' +
      '}' +
      '},3000)'

    // Remove any leftover bosun container from a previous attempt
    try {
      await execFileAsync(dockerPath, ['rm', '-f', 'slipway-bosun'])
    } catch {
      // Ignore — container may not exist
    }

    await execFileAsync(dockerPath, [
      'run',
      '-d',
      '--rm',
      '--name',
      'slipway-bosun',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      pullTarget,
      'node',
      '-e',
      script
    ])

    sails.log.info(
      '[slipway] Update initiated — bosun container spawned, restart in ~3 seconds'
    )

    return {
      status: 'updating',
      currentVersion: updateInfo.currentVersion,
      targetVersion: updateInfo.latestVersion
    }
  }
}
