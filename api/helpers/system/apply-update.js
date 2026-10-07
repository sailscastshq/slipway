const { execFile, spawn } = require('child_process')
const util = require('util')
const execute = util.promisify(execFile)
async function execFileAsync(dockerPath, args, options, sensitiveArgs = []) {
  try {
    return await execute(dockerPath, args, options)
  } catch (error) {
    const safe = new Error(
      sails.helpers.docker.formatError.with({
        error,
        args: [...args, ...sensitiveArgs]
      })
    )
    if (error.code !== undefined) safe.code = error.code
    safe.stderr = safe.message
    throw safe
  }
}

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
    },
    validationFailed: {
      description: 'The candidate could not start or did not pass validation.'
    }
  },

  fn: async function () {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const githubRepo =
      sails.config.slipway?.githubRepo || 'sailscastshq/slipway'
    const imageRepository = `ghcr.io/${githubRepo}`
    const CACHE_KEY = 'slipway_update_progress'
    const appsDir = sails.config.custom.slipwayAppsDir || '/var/slipway/apps'
    let validationMayExist = false

    async function setProgress(phase, detail) {
      await sails.cache.set(
        CACHE_KEY,
        { phase, detail, updatedAt: Date.now() },
        900000
      )
      sails.log.info(
        `[slipway] Update progress: ${phase}${detail ? ' — ' + detail : ''}`
      )
    }

    try {
      // 1. Check that an update is actually available
      await setProgress('checking', 'Verifying update availability')
      const updateInfo = await sails.helpers.system.checkForUpdates()
      if (!updateInfo.updateAvailable) {
        await setProgress('idle', null)
        throw 'noUpdate'
      }

      const pullTarget = await sails.helpers.system.getUpdateImageRef.with({
        updateInfo,
        imageRepository
      })

      // 2. Pull the advertised image
      await setProgress('pulling', `Pulling ${pullTarget}`)
      try {
        await execFileAsync(dockerPath, ['pull', pullTarget], {
          timeout: 300000
        })
      } catch (err) {
        sails.log.error(
          `[slipway] Failed to pull ${pullTarget}: ${err.message}`
        )
        await setProgress('failed', `Failed to pull ${pullTarget}`)
        throw 'pullFailed'
      }

      // 3. Back up the SQLite database
      await setProgress('backing-up', 'Creating pre-update database snapshot')
      const backup = await sails.helpers.system.backupDatabase()
      if (!backup?.localVerified)
        throw new Error(
          'Update stopped: no verified system backup is available.'
        )
      if (backup.skipped) await setProgress('backing-up', backup.reason)

      // 4. Inspect current container to reconstruct its config
      await setProgress('inspecting', 'Reading current container configuration')
      let containerInfo
      try {
        const { stdout } = await execFileAsync(dockerPath, [
          'inspect',
          'slipway'
        ])
        containerInfo = JSON.parse(stdout)[0]
      } catch (err) {
        sails.log.error(`[slipway] Failed to inspect container: ${err.message}`)
        await setProgress('failed', 'Could not read current container config')
        throw 'pullFailed'
      }

      // 4b. Make sure deployed source survives container replacement.
      if (!hasMountDestination(containerInfo, appsDir)) {
        await setProgress(
          'inspecting',
          'Migrating deployed source into persistent storage'
        )
        await migrateAppsDirectoryToBindMount({
          dockerPath,
          containerName: 'slipway',
          appsDir
        })
      }

      // 5. Build reusable Docker arguments from current container config
      const dockerArgs = await sails.helpers.system.buildUpdateDockerArgs.with({
        containerInfo,
        extraMounts: [
          {
            type: 'bind',
            source: appsDir,
            destination: appsDir
          }
        ]
      })
      const baseArgs = dockerArgs.runArgs

      // 6. Validate through container-local health; no host port is needed.
      await setProgress(
        'validating',
        'Starting temporary container for health check'
      )
      // Keep mounts, environment and network, without publishing a host port.
      const tempArgs = ['run', '-d', '--name', 'slipway-next']

      // Network (needed for Docker DNS / volume access)
      const networks = Object.keys(
        containerInfo.NetworkSettings?.Networks || {}
      )
      if (networks.length > 0) {
        tempArgs.push('--network', networks[0])
      }

      tempArgs.push(...dockerArgs.mountArgs)

      tempArgs.push(...dockerArgs.envArgs)

      tempArgs.push(pullTarget)

      // Clean up any leftover temp container
      try {
        await execFileAsync(dockerPath, ['rm', '-f', 'slipway-next'])
      } catch {
        /* ignore */
      }

      validationMayExist = true
      try {
        await execFileAsync(dockerPath, tempArgs)
      } catch (err) {
        sails.log.error(
          `[slipway] Failed to start validation container: ${err.message}`
        )
        await setProgress('failed', 'New image failed to start')
        throw 'validationFailed'
      }

      // 7. Health-check the validation container
      await setProgress('validating', 'Health-checking new version')
      try {
        await sails.helpers.docker.healthCheckContainer.with({
          containerName: 'slipway-next',
          port: 1337,
          path: '/health',
          timeout: 360000,
          interval: 2000
        })
      } catch (err) {
        sails.log.error(
          `[slipway] Validation container failed health check: ${err.message}`
        )
        const validationLogs = await getContainerLogs(
          dockerPath,
          'slipway-next'
        )
        if (validationLogs) {
          const safeLogs = sails.helpers.docker.formatError.with({
            error: { stderr: validationLogs },
            args: dockerArgs.envArgs
          })
          sails.log.error(`[slipway] Validation container logs:\n${safeLogs}`)
        }
        await setProgress(
          'failed',
          'New version failed health check — update aborted, current version untouched'
        )
        throw 'validationFailed'
      }

      const { stdout: validationBody } = await execFileAsync(
        dockerPath,
        [
          'exec',
          'slipway-next',
          'curl',
          '-fsS',
          '--max-time',
          '5',
          'http://localhost:1337/health'
        ],
        { timeout: 7000, maxBuffer: 64 * 1024 }
      )
      const validation = JSON.parse(validationBody)
      if (validation.mode === 'preflight') {
        if (validation.normalStartupReady !== false) throw 'validationFailed'
        sails.log.info(
          '[slipway] Migration preflight passed on database copies; live changes follow after the previous server stops'
        )
      } else if (validation.status !== 'ok') throw 'validationFailed'
      else
        sails.log.info('[slipway] Validation passed — new version is healthy')

      // 8. Remove validation before the production swap.
      await execFileAsync(dockerPath, ['rm', '-f', 'slipway-next'])
      validationMayExist = false

      // 9. Build final run args for the production container
      const runArgs = [
        'run',
        '-d',
        '--name',
        'slipway',
        '--restart',
        'unless-stopped'
      ]
      runArgs.push(...baseArgs)
      runArgs.push(pullTarget)

      // 10. Spawn the bosun sidecar to perform the swap
      await setProgress(
        'swapping',
        'Swapping containers — previous version will be kept until the new one is healthy'
      )

      const script = await sails.helpers.system.buildUpdateSwapScript.with({
        runArgs
      })

      // Remove any leftover bosun container from a previous attempt
      try {
        await execFileAsync(dockerPath, ['rm', '-f', 'slipway-bosun'])
      } catch {
        /* ignore */
      }

      await execFileAsync(
        dockerPath,
        [
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
        ],
        undefined,
        dockerArgs.envArgs
      )

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
        targetVersion: updateInfo.latestVersion,
        targetImage: pullTarget
      }
    } catch (err) {
      if (validationMayExist) {
        try {
          await execFileAsync(dockerPath, ['rm', '-f', 'slipway-next'])
        } catch (cleanupError) {
          sails.log.error(
            `[slipway] Could not remove validation container: ${cleanupError.message}`
          )
        }
        validationMayExist = false
      }

      // Re-throw Sails exit signals
      if (typeof err === 'string') throw err
      await setProgress('failed', err.message)
      throw 'pullFailed'
    }
  }
}

function hasMountDestination(containerInfo, destination) {
  return (containerInfo?.Mounts || []).some(
    (mount) => mount.Destination === destination
  )
}

async function migrateAppsDirectoryToBindMount({
  dockerPath,
  containerName,
  appsDir
}) {
  const hasSource = await containerDirectoryHasFiles({
    dockerPath,
    containerName,
    appsDir
  })

  if (!hasSource) {
    return
  }

  await streamContainerDirectoryToBindMount({
    dockerPath,
    containerName,
    appsDir
  })
}

async function containerDirectoryHasFiles({
  dockerPath,
  containerName,
  appsDir
}) {
  try {
    const { stdout } = await execFileAsync(
      dockerPath,
      [
        'exec',
        containerName,
        'sh',
        '-lc',
        `test -d ${appsDir} && [ "$(ls -A ${appsDir} 2>/dev/null)" ] && printf yes || true`
      ],
      { timeout: 10000 }
    )

    return stdout.trim() === 'yes'
  } catch {
    return false
  }
}

function streamContainerDirectoryToBindMount({
  dockerPath,
  containerName,
  appsDir
}) {
  return new Promise((resolve, reject) => {
    const exportProc = spawn(dockerPath, [
      'exec',
      containerName,
      'tar',
      'cf',
      '-',
      '-C',
      appsDir,
      '.'
    ])
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
            `${
              exportStderr.trim() ||
              importStderr.trim() ||
              'Unknown Docker error.'
            }`
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

async function getContainerLogs(dockerPath, containerName) {
  try {
    const { stdout, stderr } = await execFileAsync(
      dockerPath,
      ['logs', '--tail', '200', containerName],
      { timeout: 10000 }
    )

    return [stdout, stderr].filter(Boolean).join('').trim()
  } catch (err) {
    return err.stderr ? String(err.stderr).trim() : null
  }
}
