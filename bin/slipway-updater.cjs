#!/usr/bin/env node
// Shared detached update engine. Never lifts Sails or runs installer host setup.
const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const { setTimeout: delay } = require('node:timers/promises')
const { formatDockerError } =
  require('../api/helpers/docker/format-error')._private
const {
  fn: buildArgs,
  networkAliases
} = require('../api/helpers/system/build-update-docker-args')
const execute = promisify(execFile)
const PREFIX = 'SLIPWAY_UPDATE '
const TERMINAL = new Set(['success', 'failed', 'rolled-back', 'interrupted'])
const owned = (info) =>
  info?.Config?.Labels?.['slipway.updater.protocol'] === '1'
const missing = (error) =>
  /No such (?:object|container|image)/i.test(error.message)

function createUpdater({
  docker: suppliedDocker,
  sleep = delay,
  now = Date.now,
  emit = console.log,
  binary = 'docker',
  migrateApps
} = {}) {
  let sensitive = []
  const docker =
    suppliedDocker ||
    (async (args, options = {}) => {
      try {
        const { stdout } = await execute(binary, args, {
          timeout: 30000,
          maxBuffer: 16 * 1024 * 1024,
          ...options
        })
        return stdout
      } catch (error) {
        const safe = new Error(
          formatDockerError(error, [...args, ...sensitive])
        )
        safe.code = error.code
        throw safe
      }
    })
  async function inspect(name) {
    try {
      return JSON.parse(await docker(['inspect', name]))[0]
    } catch (error) {
      if (missing(error)) return null
      throw error
    }
  }
  async function health(name, port = 1337) {
    return JSON.parse(
      await docker(
        [
          'exec',
          name,
          'curl',
          '-fsS',
          '--max-time',
          '5',
          `http://localhost:${port}/health`
        ],
        { timeout: 7000, maxBuffer: 65536 }
      )
    )
  }
  const normal = (data, version, checksum) =>
    data?.status === 'ok' &&
    data.mode !== 'preflight' &&
    (!version || data.version === version) &&
    data.releaseMigrations?.ready === true &&
    (!checksum || data.releaseMigrations.checksum === checksum)
  async function status({ containerName = 'slipway' } = {}) {
    const job = await inspect(containerName + '-updater')
    if (!job) return { phase: 'idle', canRetry: true }
    if (!owned(job))
      throw new Error(
        'Updater container name is occupied by an unmanaged container. No containers were removed.'
      )
    const labels = job.Config.Labels
    let event
    try {
      const lines = String(
        await docker(['logs', '--tail', '100', job.Id], {
          maxBuffer: 1024 * 1024
        })
      ).split('\n')
      for (const line of lines)
        if (line.startsWith(PREFIX)) {
          try {
            const value = JSON.parse(line.slice(PREFIX.length))
            if (value.operationId === labels['slipway.updater.operation'])
              event = value
          } catch {}
        }
    } catch {
      /* The admission label remains authoritative before the first log. */
    }
    const base = {
      operationId: labels['slipway.updater.operation'],
      targetVersion: labels['slipway.updater.version'],
      phase: 'starting',
      updatedAt: Number(labels['slipway.updater.created']),
      canRetry: false,
      ...event
    }
    if (
      job.State?.Running ||
      (job.State?.Status === 'created' &&
        now() - Number(labels['slipway.updater.created']) < 30000)
    )
      return base
    if (TERMINAL.has(base.phase)) return base
    // A dead runner is not proof of rollback. Reconcile only from exact container identity and normal health.
    const live = await inspect(containerName)
    if (live?.State?.Running) {
      let ready
      try {
        ready = await health(containerName, base.port)
      } catch {}
      if (
        live.Image === base.targetImageId &&
        normal(ready, base.targetVersion, base.checksum)
      )
        return {
          ...base,
          phase: 'success',
          detail: 'Target version verified after reconnecting.',
          reconciled: true,
          canRetry: false
        }
      const leftover = await inspect(
        base.preflightName ||
          `${containerName}-next-${base.operationId.slice(0, 8)}`
      )
      const helper = await inspect(
        `${containerName}-snapshot-${base.operationId.slice(0, 8)}`
      )
      if (
        live.Id === labels['slipway.updater.source'] &&
        normal(ready) &&
        !leftover &&
        !helper
      )
        return {
          ...base,
          phase: 'failed',
          detail:
            'Updater stopped; the original container is still healthy. It is safe to retry.',
          reconciled: true,
          canRetry: true
        }
    }
    return {
      ...base,
      phase: 'interrupted',
      detail:
        'Update ownership was interrupted. Inspect the retained updater and rollback containers before retrying.',
      canRetry: false
    }
  }
  async function start({
    targetImage,
    targetVersion,
    containerName = 'slipway',
    runnerImage,
    appsDir = '/var/slipway/apps',
    skipPull = false
  }) {
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(containerName) ||
      !/^\/(?!.*[\n\r])/.test(appsDir)
    )
      throw new Error('Invalid updater container or source directory.')
    if (
      !/^(?:v?\d+\.\d+\.\d+|latest)$/.test(targetVersion || '') ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_./:@-]+$/.test(targetImage || '')
    )
      throw new Error(
        'Review a valid release image and version before updating.'
      )
    const name = containerName + '-updater'
    const oldJob = await inspect(name)
    if (oldJob) {
      const state = await status({ containerName })
      if (
        oldJob.State?.Running ||
        (oldJob.State?.Status === 'created' && state.phase === 'starting')
      )
        return { ...state, adopted: true }
      if (
        state.phase === 'interrupted' ||
        (state.phase !== 'success' && !state.canRetry)
      )
        throw new Error(state.detail)
      try {
        await docker(['rm', oldJob.Id])
      } catch (error) {
        if (!missing(error)) throw error
      }
    }
    const source = await inspect(containerName)
    if (!source)
      throw new Error(
        'The existing Slipway container must be running before an update can be admitted.'
      )
    const operationId = randomUUID()
    const image = runnerImage || source.Image
    const args = [
      'create',
      '--name',
      name,
      '--init',
      '--no-healthcheck',
      '--label',
      'slipway.updater.protocol=1',
      '--label',
      `slipway.updater.operation=${operationId}`,
      '--label',
      `slipway.updater.version=${targetVersion}`,
      '--label',
      `slipway.updater.source=${source.Id}`,
      '--label',
      `slipway.updater.created=${now()}`,
      '--log-opt',
      'max-size=1m',
      '--log-opt',
      'max-file=2',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock',
      '--entrypoint',
      'node',
      image,
      '/app/bin/slipway-updater.cjs',
      'run',
      '--container',
      containerName,
      '--image',
      targetImage,
      '--version',
      targetVersion,
      '--operation',
      operationId,
      '--apps-dir',
      appsDir,
      '--source',
      source.Id,
      '--skip-pull',
      String(skipPull === true)
    ]
    let id
    try {
      id = String(await docker(args)).trim()
    } catch (error) {
      // Docker's unique name is the cross-process admission lock for terminal and UI.
      if (/already in use|Conflict/i.test(error.message))
        return { ...(await status({ containerName })), adopted: true }
      throw error
    }
    try {
      await docker(['start', id])
    } catch (error) {
      try {
        await docker(['rm', id])
      } catch {}
      throw error
    }
    return {
      operationId,
      phase: 'starting',
      targetVersion,
      canRetry: false,
      updatedAt: now()
    }
  }
  async function run({
    targetImage,
    targetVersion,
    containerName = 'slipway',
    operationId,
    appsDir = '/var/slipway/apps',
    sourceId,
    skipPull = false
  }) {
    if (!/^[a-f0-9-]{36}$/.test(operationId || ''))
      throw new Error('A server-owned update operation is required.')
    const preflightName = `${containerName}-next-${operationId.slice(0, 8)}`
    const backupName = `${containerName}-previous-${operationId.slice(0, 8)}`
    const helperName = `${containerName}-snapshot-${operationId.slice(0, 8)}`
    let state = {
      operationId,
      targetVersion,
      preflightName,
      backupContainerName: backupName,
      phase: 'checking',
      canRetry: false,
      sequence: 0,
      updatedAt: now()
    }
    const progress = (phase, detail, extra = {}) => {
      state = {
        ...state,
        ...extra,
        phase,
        detail,
        sequence: state.sequence + 1,
        updatedAt: now()
      }
      emit(PREFIX + JSON.stringify(state))
      return state
    }
    let originalHealth
    let source,
      candidateId,
      validationId,
      renamed = false,
      beforeSwap = true
    const assertOwner = async () => {
      const job = await inspect(containerName + '-updater')
      if (
        !owned(job) ||
        job.Config.Labels['slipway.updater.operation'] !== operationId ||
        job.Config.Labels['slipway.updater.source'] !== sourceId
      )
        throw new Error(
          'Update ownership changed; no further container mutations are permitted.'
        )
    }
    const waitReady = async (name, accepts, label, expectedId) => {
      const deadline = now() + 360000
      while (now() < deadline) {
        await assertOwner()
        const current = await inspect(name)
        if (current?.Id !== expectedId)
          throw new Error(
            label + ' container identity changed during verification.'
          )
        if (!current.State?.Running && !current.State?.Restarting)
          throw new Error(label + ' exited before completing normal readiness.')
        try {
          const data = await health(name, state.port)
          if (accepts(data)) return data
        } catch {}
        await sleep(2000)
      }
      throw new Error(label + ' did not complete readiness within six minutes.')
    }
    try {
      progress(
        'checking',
        'Checking the current container and update ownership'
      )
      await assertOwner()
      source = await inspect(containerName)
      if (source?.Id !== sourceId)
        throw new Error(
          'The current Slipway container changed before the update started.'
        )
      sensitive = (source.Config.Env || []).flatMap((value) => ['-e', value])
      const db = (source.Mounts || []).find((m) => m.Destination === '/app/db')
      if (!db || db.RW === false || !['bind', 'volume'].includes(db.Type))
        throw new Error(
          'A writable persistent database mount is required; the current release is unchanged.'
        )
      const port = Number(
        (source.Config.Env || [])
          .find((v) => v.startsWith('PORT='))
          ?.slice(5) || 1337
      )
      if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('The current container has an invalid internal port.')
      state.port = port
      originalHealth = source.State?.Running
        ? await health(containerName, port)
        : null
      if (source.State?.Running && !normal(originalHealth))
        throw new Error(
          'The original Slipway container has not completed normal startup; update stopped.'
        )
      progress('pulling', 'Downloading the reviewed release image')
      if (!skipPull) await docker(['pull', targetImage], { timeout: 300000 })
      const image = JSON.parse(
        await docker(['image', 'inspect', targetImage])
      )[0]
      const imageId = image.Id
      const sourceImage = JSON.parse(
        await docker(['image', 'inspect', source.Image])
      )[0]
      for (const key of ['Cmd', 'Entrypoint', 'Healthcheck']) {
        if (
          JSON.stringify(source.Config[key] ?? null) !==
          JSON.stringify(sourceImage.Config?.[key] ?? null)
        )
          throw new Error(
            `Custom ${key} overrides require operator review before updating; the current container is unchanged.`
          )
      }
      const metadata = JSON.parse(
        await docker(
          [
            'run',
            '--rm',
            '--entrypoint',
            'node',
            imageId,
            '-e',
            "console.log(JSON.stringify({version:require('/app/package.json').version,checksum:require('/app/api/lib/release-migrations').checksum}))"
          ],
          { timeout: 30000 }
        )
      )
      if (
        !/^\d+\.\d+\.\d+$/.test(metadata.version) ||
        !metadata.checksum ||
        (targetVersion !== 'latest' &&
          metadata.version !== targetVersion.replace(/^v/, ''))
      )
        throw new Error(
          'Published image metadata does not match the requested release.'
        )
      targetVersion = metadata.version
      progress('backing-up', 'Verifying snapshots of all four datastores', {
        targetVersion,
        targetImageId: imageId,
        checksum: metadata.checksum
      })
      const mount =
        db.Type === 'volume' ? `${db.Name}:/app/db` : `${db.Source}:/app/db`
      const backupDirectory = `/app/db/system-backups/${operationId}`
      const capacity = JSON.parse(
        await docker(
          [
            'run',
            '--rm',
            '--name',
            helperName,
            '--label',
            `slipway.updater.operation=${operationId}`,
            '-v',
            mount,
            '--entrypoint',
            'node',
            imageId,
            '-e',
            "const f=require('fs'),p='/app/db';const bytes=['app.db','observability.db','analytics.db','stash.db'].reduce((n,k)=>n+f.statSync(p+'/'+k).size,0);const d=f.statfsSync(p);if(bytes>50*1024**3||Number(d.bavail)*Number(d.bsize)<bytes*3+512*1024**2)throw Error('Insufficient capacity for a verified update backup');f.mkdirSync(p+'/system-backups',{recursive:true,mode:0o700});console.log(JSON.stringify({capacityVerified:true}))"
          ],
          { timeout: 30000 }
        )
      )
      if (!capacity.capacityVerified)
        throw new Error('Update backup capacity could not be verified.')
      const snapshot = JSON.parse(
        await docker(
          [
            'run',
            '--rm',
            '--name',
            helperName,
            '--label',
            `slipway.updater.operation=${operationId}`,
            '-v',
            mount,
            '--entrypoint',
            'node',
            imageId,
            '/app/bin/slipway-database.cjs',
            'snapshot',
            '--directory',
            '/app/db',
            '--output',
            backupDirectory
          ],
          { timeout: 300000, maxBuffer: 131072 }
        )
      )
      if (
        !snapshot.archive ||
        !snapshot.manifest?.databases?.length ||
        snapshot.manifest.databases.length !== 4 ||
        snapshot.manifest.databases.some(
          (x) => x.integrity !== 'ok' || x.foreignKeys !== 'ok'
        )
      )
        throw new Error(
          'Verified database snapshots are required before replacing Slipway.'
        )
      // The resident app's Quest worker archives this verified bundle using the
      // existing private-storage adapters. A restart cannot lose the pending marker.
      await docker([
        'run',
        '--rm',
        '--name',
        helperName,
        '--label',
        `slipway.updater.operation=${operationId}`,
        '-v',
        mount,
        '--entrypoint',
        'node',
        imageId,
        '-e',
        "const f=require('fs'),p=process.argv[1]+'/remote-pending.json';f.writeFileSync(p,JSON.stringify({version:1}),{mode:0o600,flag:'wx'})",
        backupDirectory
      ])
      state.remoteArchive = 'pending'
      progress(
        'inspecting',
        'Preserving the existing container configuration',
        { backupDirectory }
      )
      const hasApps = source.Mounts.some((m) => m.Destination === appsDir)
      if (!hasApps) {
        const hasFiles =
          String(
            await docker([
              'exec',
              source.Id,
              'node',
              '-e',
              "const f=require('fs'),p=process.argv[1];console.log(f.existsSync(p)&&f.readdirSync(p).length>0)",
              appsDir
            ])
          ).trim() === 'true'
        if (hasFiles) {
          if (migrateApps) await migrateApps({ source, appsDir, imageId })
          else
            await new Promise((resolve, reject) => {
              const out = spawn(
                binary,
                ['cp', `${source.Id}:${appsDir}/.`, '-'],
                { stdio: ['ignore', 'pipe', 'pipe'] }
              )
              const into = spawn(
                binary,
                [
                  'run',
                  '--rm',
                  '-i',
                  '--name',
                  helperName,
                  '--label',
                  `slipway.updater.operation=${operationId}`,
                  '-v',
                  `${appsDir}:${appsDir}`,
                  '--entrypoint',
                  'sh',
                  imageId,
                  '-c',
                  'mkdir -p "$1" && tar xf - -C "$1"',
                  'updater',
                  appsDir
                ],
                { stdio: ['pipe', 'ignore', 'pipe'] }
              )
              let finished = 0,
                failed = false
              const timer = setTimeout(
                () =>
                  stop(
                    new Error(
                      'Source-cache preservation exceeded its deadline.'
                    )
                  ),
                300000
              )
              const stop = (error) => {
                if (failed) return
                failed = true
                clearTimeout(timer)
                out.kill('SIGTERM')
                into.kill('SIGTERM')
                reject(error)
              }
              out.stderr.resume()
              into.stderr.resume()
              into.stdin.on('error', () => {})
              out.on('error', () =>
                stop(new Error('Could not preserve the existing source cache.'))
              )
              into.on('error', () =>
                stop(new Error('Could not persist the existing source cache.'))
              )
              for (const process of [out, into])
                process.on('close', (code) => {
                  if (code !== 0)
                    stop(
                      new Error(
                        'Source-cache preservation failed; current release is unchanged.'
                      )
                    )
                  else if (++finished === 2 && !failed) {
                    clearTimeout(timer)
                    resolve()
                  }
                })
              out.stdout.pipe(into.stdin)
            })
        }
      }
      const config = await buildArgs({
        containerInfo: source,
        extraMounts: [{ type: 'bind', source: appsDir, destination: appsDir }]
      })
      const network = Object.keys(source.NetworkSettings?.Networks || {})[0]
      const networkArgs = network ? ['--network', network] : []
      progress(
        'validating',
        'Checking migrations on database copies before stopping the current server'
      )
      validationId = String(
        await docker([
          'run',
          '-d',
          '--name',
          preflightName,
          '--label',
          `slipway.updater.operation=${operationId}`,
          '--label',
          'slipway.update.role=preflight',
          ...networkArgs,
          ...config.mountArgs,
          ...config.envArgs,
          imageId
        ])
      ).trim()
      await waitReady(
        preflightName,
        (h) =>
          h.mode === 'preflight' &&
          h.normalStartupReady === false &&
          h.version === '0.0.88',
        'Migration preflight',
        validationId
      )
      await docker(['rm', '-f', validationId])
      validationId = null
      await assertOwner()
      if ((await inspect(containerName))?.Id !== sourceId)
        throw new Error('Current container ownership changed before swap.')
      progress(
        'swapping',
        'Keeping the previous container until the target completes normal startup'
      )
      await docker(['rename', sourceId, backupName])
      renamed = true
      beforeSwap = false
      await docker(['stop', sourceId], { timeout: 60000 })
      candidateId = String(
        await docker([
          'run',
          '-d',
          '--name',
          containerName,
          '--label',
          `slipway.updater.operation=${operationId}`,
          ...config.runArgs,
          imageId
        ])
      ).trim()
      for (const otherNetwork of Object.keys(
        source.NetworkSettings?.Networks || {}
      ).slice(1))
        await docker([
          'network',
          'connect',
          ...networkAliases(source, otherNetwork).flatMap((alias) => [
            '--alias',
            alias
          ]),
          otherNetwork,
          candidateId
        ])
      progress(
        'waiting',
        'Waiting for the exact target version and normal startup receipts'
      )
      await waitReady(
        containerName,
        (h) => normal(h, targetVersion, metadata.checksum),
        'Target Slipway',
        candidateId
      )
      // Do not remove a rollback target that another operator has restarted or renamed.
      const previous = await inspect(sourceId)
      if (previous?.Name === '/' + backupName && !previous.State?.Running) {
        try {
          await docker(['rm', sourceId])
        } catch {
          return progress(
            'success',
            'Target version is verified. The stopped rollback container was retained because cleanup could not finish.',
            { canRetry: false, cleanupPending: true }
          )
        }
      }
      return progress(
        'success',
        'Update complete. The target version and startup receipts are verified.',
        { canRetry: false }
      )
    } catch (error) {
      let cleanupVerified = true
      for (const temporary of [preflightName, helperName])
        try {
          const partial = await inspect(temporary)
          if (
            partial?.Config?.Labels?.['slipway.updater.operation'] ===
            operationId
          )
            await docker(['rm', '-f', partial.Id])
        } catch {
          cleanupVerified = false
          /* Retain uncertain containers for operator review. */
        }
      if (renamed) {
        progress(
          'rolling-back',
          'Restoring the previous container; database migration evidence is retained'
        )
        try {
          await assertOwner()
          if (candidateId) {
            const current = await inspect(containerName)
            if (current?.Id !== candidateId)
              throw new Error(
                'Candidate ownership changed; rollback requires operator review.'
              )
            await docker(['rm', '-f', candidateId])
          } else {
            const partial = await inspect(containerName)
            if (partial) {
              if (
                partial.Config?.Labels?.['slipway.updater.operation'] !==
                operationId
              )
                throw new Error(
                  'A different container owns the live name; rollback requires operator review.'
                )
              await docker(['rm', '-f', partial.Id])
            }
          }
          await docker(['rename', sourceId, containerName])
          await docker(['start', sourceId])
          await waitReady(
            containerName,
            (h) =>
              normal(
                h,
                originalHealth?.version,
                originalHealth?.releaseMigrations?.checksum
              ),
            'Previous Slipway',
            sourceId
          )
          return progress(
            'rolled-back',
            'The update did not pass readiness. The previous container is restored and healthy. Verified backups and migration evidence are retained.',
            { canRetry: true }
          )
        } catch {
          return progress(
            'interrupted',
            'Rollback could not be verified. Keep the retained backup and containers; inspect updater logs before retrying.',
            { canRetry: false }
          )
        }
      }
      return progress(
        'failed',
        String(error.message || 'Update preparation failed.').slice(0, 1200),
        { canRetry: beforeSwap && cleanupVerified }
      )
    }
  }
  return { start, status, run }
}

async function main(args) {
  const command = args.shift(),
    options = {}
  const names = {
    '--image': 'targetImage',
    '--version': 'targetVersion',
    '--container': 'containerName',
    '--runner-image': 'runnerImage',
    '--operation': 'operationId',
    '--apps-dir': 'appsDir',
    '--source': 'sourceId',
    '--skip-pull': 'skipPull'
  }
  while (args.length) {
    const key = args.shift()
    if (!names[key] || !args.length) throw new Error('Unknown updater option')
    options[names[key]] = args.shift()
  }
  options.skipPull = options.skipPull === 'true'
  const engine = createUpdater()
  if (command === 'start' || command === 'status')
    console.log(JSON.stringify(await engine[command](options)))
  else if (command === 'watch') {
    const deadline = Date.now() + 40 * 60 * 1000
    let last
    while (Date.now() < deadline) {
      const state = await engine.status(options)
      const key = `${state.operationId}:${state.phase}:${state.detail}`
      if (key !== last) {
        console.log(state.detail || state.phase)
        last = key
      }
      if (TERMINAL.has(state.phase)) {
        if (state.phase !== 'success') process.exitCode = 1
        return
      }
      await delay(2000)
    }
    throw new Error(
      'Update observation deadline exceeded; inspect the retained operation before retrying.'
    )
  } else if (command === 'run') {
    const result = await engine.run(options)
    if (result.phase !== 'success') process.exitCode = 1
  } else
    throw new Error(
      'Usage: slipway-updater start|status|watch|run --container NAME --image IMAGE --version VERSION'
    )
}
module.exports = { createUpdater, PREFIX, TERMINAL, main }
if (require.main === module)
  main(process.argv.slice(2)).catch(() => {
    console.error(
      'Updater could not start. Inspect the existing update operation before retrying.'
    )
    process.exitCode = 1
  })
