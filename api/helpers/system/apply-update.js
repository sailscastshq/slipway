const { execFile, spawn } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Apply update',

  description:
    'Blue-green self-update: pull new image, validate it in a temp container, then swap.',

  inputs: {},

  exits: {
    success: {
      description: 'Update initiated successfully.'
    },
    noUpdate: {
      description: 'Already running the latest version.'
    },
    pullFailed: {
      description: 'Failed to pull the new image.'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const image = 'ghcr.io/sailscastshq/slipway'
    const CACHE_KEY = 'slipway_update_progress'
    const appsDir = sails.config.custom.slipwayAppsDir || '/var/slipway/apps'

    async function setProgress(phase, detail) {
      await sails.cache.set(CACHE_KEY, { phase, detail, updatedAt: Date.now() }, 300000)
      sails.log.info(`[slipway] Update progress: ${phase}${detail ? ' — ' + detail : ''}`)
    }

    try {
      // 1. Check that an update is actually available
      await setProgress('checking', 'Verifying update availability')
      const updateInfo = await sails.helpers.system.checkForUpdates()
      if (!updateInfo.updateAvailable) {
        await setProgress('idle', null)
        throw 'noUpdate'
      }

      const pullTarget = `${image}:latest`

      // 2. Pull the latest image
      await setProgress('pulling', `Pulling ${pullTarget}`)
      try {
        await execFileAsync(dockerPath, ['pull', pullTarget], {
          timeout: 300000
        })
      } catch (err) {
        sails.log.error(`[slipway] Failed to pull image: ${err.message}`)
        await setProgress('failed', 'Failed to pull the latest image')
        throw 'pullFailed'
      }

      // 3. Back up the SQLite database
      await setProgress('backing-up', 'Creating pre-update database snapshot')
      await sails.helpers.system.backupDatabase()

      // 4. Inspect current container to reconstruct its config
      await setProgress('inspecting', 'Reading current container configuration')
      let containerInfo
      try {
        const { stdout } = await execFileAsync(dockerPath, ['inspect', 'slipway'])
        containerInfo = JSON.parse(stdout)[0]
      } catch (err) {
        sails.log.error(`[slipway] Failed to inspect container: ${err.message}`)
        await setProgress('failed', 'Could not read current container config')
        throw 'pullFailed'
      }

      // 4b. Make sure deployed source survives container replacement.
      if (!hasMountDestination(containerInfo, appsDir)) {
        await setProgress('inspecting', 'Migrating deployed source into persistent storage')
        await migrateAppsDirectoryToBindMount({
          dockerPath,
          containerName: 'slipway',
          appsDir
        })
      }

      // 5. Build base docker run arguments from current container config
      const baseArgs = buildRunArgs(containerInfo, {
        extraMounts: [
          {
            type: 'bind',
            source: appsDir,
            destination: appsDir
          }
        ]
      })

      // 6. Start a validation container (slipway-next) on a temporary port
      await setProgress('validating', 'Starting temporary container for health check')
      const tempPort = await sails.helpers.docker.allocatePort()

      // Build temp container args: same config but different name + temp port
      const tempArgs = ['run', '-d', '--name', 'slipway-next']

      // Network (needed for Docker DNS / volume access)
      const networks = Object.keys(containerInfo.NetworkSettings?.Networks || {})
      if (networks.length > 0) {
        tempArgs.push('--network', networks[0])
      }

      appendMountArgs(tempArgs, containerInfo.Mounts, [
        {
          type: 'bind',
          source: appsDir,
          destination: appsDir
        }
      ])

      // Temp port binding (different from production port)
      tempArgs.push('-p', `${tempPort}:1337`)

      // Environment variables (same as original)
      for (const envVar of containerInfo.Config?.Env || []) {
        tempArgs.push('-e', envVar)
      }

      tempArgs.push(pullTarget)

      // Clean up any leftover temp container
      try {
        await execFileAsync(dockerPath, ['rm', '-f', 'slipway-next'])
      } catch { /* ignore */ }

      try {
        await execFileAsync(dockerPath, tempArgs)
      } catch (err) {
        sails.log.error(`[slipway] Failed to start validation container: ${err.message}`)
        await setProgress('failed', 'New image failed to start')
        throw 'pullFailed'
      }

      // 7. Health-check the validation container
      await setProgress('validating', 'Health-checking new version')
      try {
        await sails.helpers.docker.healthCheck.with({
          containerName: 'slipway-next',
          port: 1337,
          hostPort: tempPort,
          path: '/health',
          timeout: 60000,
          interval: 2000
        })
      } catch (err) {
        sails.log.error(`[slipway] Validation container failed health check: ${err.message}`)
        // Clean up the failed temp container
        try {
          await execFileAsync(dockerPath, ['rm', '-f', 'slipway-next'])
        } catch { /* ignore */ }
        await setProgress('failed', 'New version failed health check — update aborted, current version untouched')
        throw 'pullFailed'
      }

      sails.log.info('[slipway] Validation passed — new version is healthy')

      // 8. Stop the validation container (free the temp port before swap)
      try {
        await execFileAsync(dockerPath, ['rm', '-f', 'slipway-next'])
      } catch { /* ignore */ }

      // 9. Build final run args for the production container
      const runArgs = ['run', '-d', '--name', 'slipway', '--restart', 'unless-stopped']
      runArgs.push(...baseArgs)
      runArgs.push(pullTarget)

      // 10. Spawn the bosun sidecar to perform the swap
      await setProgress('swapping', 'Swapping containers — Slipway will restart momentarily')

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
        'try{console.log("Attempting recovery...");' +
        'execFileSync("docker",' +
        argsJson +
        ');}catch(e2){console.error("Recovery failed:",e2.message)}' +
        'process.exit(1)' +
        '}' +
        '},3000)'

      // Remove any leftover bosun container from a previous attempt
      try {
        await execFileAsync(dockerPath, ['rm', '-f', 'slipway-bosun'])
      } catch { /* ignore */ }

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

      sails.log.info('[slipway] Bosun spawned — container swap in ~3 seconds')

      // Reset progress so the stale "swapping" phase (persisted in SQLite
      // cache) doesn't block the next update after the container restarts.
      await setProgress('idle', null)

      // Clear the update check cache so the new version doesn't show
      // a stale "update available" banner after restart.
      await sails.cache.set('slipway_update_check', null, 1)

      return {
        status: 'updating',
        currentVersion: updateInfo.currentVersion,
        targetVersion: updateInfo.latestVersion
      }
    } catch (err) {
      // Re-throw Sails exit signals
      if (typeof err === 'string') throw err
      await setProgress('failed', err.message)
      throw 'pullFailed'
    }
  }
}

/**
 * Extract reusable docker run arguments from a container's inspect output.
 * Returns an array of args (network, volumes, ports, env, labels) without
 * the `run -d --name ... --restart ...` prefix or the image suffix.
 */
function buildRunArgs(containerInfo, { extraMounts = [] } = {}) {
  const args = []

  // Network
  const networks = Object.keys(containerInfo.NetworkSettings?.Networks || {})
  if (networks.length > 0) {
    args.push('--network', networks[0])
  }

  appendMountArgs(args, containerInfo.Mounts, extraMounts)

  // Port bindings
  const portBindings = containerInfo.HostConfig?.PortBindings || {}
  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    for (const binding of bindings || []) {
      const hostPort = binding.HostPort || ''
      if (hostPort) {
        args.push('-p', `${hostPort}:${containerPort.replace('/tcp', '')}`)
      }
    }
  }

  // Environment variables
  for (const envVar of containerInfo.Config?.Env || []) {
    args.push('-e', envVar)
  }

  // Labels (skip internal Docker labels)
  for (const [key, value] of Object.entries(containerInfo.Config?.Labels || {})) {
    if (key.startsWith('org.opencontainers.') || key.startsWith('com.docker.')) {
      continue
    }
    args.push('-l', `${key}=${value}`)
  }

  return args
}

function appendMountArgs(args, mounts = [], extraMounts = []) {
  const seenDestinations = new Set()

  for (const mount of [...(mounts || []), ...(extraMounts || [])]) {
    const type = mount.Type || mount.type
    const destination = mount.Destination || mount.destination

    if (!type || !destination || seenDestinations.has(destination)) {
      continue
    }

    seenDestinations.add(destination)

    if (type === 'volume') {
      const source = mount.Name || mount.name || mount.Source || mount.source
      if (source) {
        args.push('-v', `${source}:${destination}`)
      }
      continue
    }

    if (type === 'bind') {
      const source = mount.Source || mount.source
      if (!source) {
        continue
      }

      const readOnly = mount.RW === false || mount.readOnly === true ? ':ro' : ''
      args.push('-v', `${source}:${destination}${readOnly}`)
    }
  }
}

function hasMountDestination(containerInfo, destination) {
  return (containerInfo?.Mounts || []).some((mount) => mount.Destination === destination)
}

async function migrateAppsDirectoryToBindMount({ dockerPath, containerName, appsDir }) {
  const hasSource = await containerDirectoryHasFiles({ dockerPath, containerName, appsDir })

  if (!hasSource) {
    return
  }

  await streamContainerDirectoryToBindMount({
    dockerPath,
    containerName,
    appsDir
  })
}

async function containerDirectoryHasFiles({ dockerPath, containerName, appsDir }) {
  try {
    const { stdout } = await execFileAsync(
      dockerPath,
      ['exec', containerName, 'sh', '-lc', `test -d ${appsDir} && [ "$(ls -A ${appsDir} 2>/dev/null)" ] && printf yes || true`],
      { timeout: 10000 }
    )

    return stdout.trim() === 'yes'
  } catch {
    return false
  }
}

function streamContainerDirectoryToBindMount({ dockerPath, containerName, appsDir }) {
  return new Promise((resolve, reject) => {
    const exportProc = spawn(dockerPath, ['exec', containerName, 'tar', 'cf', '-', '-C', appsDir, '.'])
    const importProc = spawn(dockerPath, [
      'run',
      '--rm',
      '-i',
      '-v',
      `${appsDir}:${appsDir}`,
      'alpine',
      'sh',
      '-lc',
      `mkdir -p ${appsDir} && tar xf - -C ${appsDir}`
    ])

    let exportStderr = ''
    let importStderr = ''
    let settled = false
    let exportCode = null
    let importCode = null

    const finish = () => {
      if (settled || exportCode === null || importCode === null) {
        return
      }

      if (exportCode === 0 && importCode === 0) {
        settled = true
        resolve()
        return
      }

      settled = true
      reject(
        new Error(
          `Could not migrate ${appsDir} into a persistent bind mount. ` +
            `${exportStderr.trim() || importStderr.trim() || 'Unknown Docker error.'}`
        )
      )
    }

    exportProc.stdout.pipe(importProc.stdin)

    exportProc.stderr.on('data', (chunk) => {
      exportStderr += chunk.toString()
    })

    importProc.stderr.on('data', (chunk) => {
      importStderr += chunk.toString()
    })

    exportProc.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      importProc.kill('SIGTERM')
      reject(error)
    })

    importProc.on('error', (error) => {
      if (settled) {
        return
      }

      settled = true
      exportProc.kill('SIGTERM')
      reject(error)
    })

    exportProc.on('close', (code) => {
      exportCode = code
      finish()
    })

    importProc.on('close', (code) => {
      importCode = code
      finish()
    })
  })
}

module.exports._private = {
  appendMountArgs,
  buildRunArgs,
  hasMountDestination,
}
