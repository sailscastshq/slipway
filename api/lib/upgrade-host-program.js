// Shared fixed host operation; no Sails lift or alternative migration engine.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const host = require('./upgrade-host-controller')
const docker = require('./upgrade-docker-api')()
const driverFactory = require('./upgrade-host-driver')
const registry = require('./upgrade-registry')
const handoff = require('./upgrade-handoff')
function officialImage(image) {
  return /^ghcr\.io\/sailscastshq\/slipway@sha256:[a-f0-9]{64}$/.test(
    image || ''
  )
}
function error(code) {
  throw Object.assign(new Error('Host operation was not confirmed.'), { code })
}
async function run(
  input,
  {
    native = false,
    imageAllowed = officialImage,
    onCheckpoint,
    nativeRevision,
    timeoutMs = 20 * 60 * 1000,
    reserveBytes = 1024 * 1024 * 1024,
    healthOverride
  } = {}
) {
  if (
    process.platform !== 'linux' ||
    process.getuid() !== 0 ||
    require('../../package.json').version !== registry.release
  )
    return error('upgradeHostEnvironment')
  if (
    !['plan', 'apply', 'prepare', 'initialize', 'status', 'resume'].includes(
      input.operation
    ) ||
    !imageAllowed(input.image) ||
    !path.isAbsolute(input.directory || '') ||
    (!native && !input.controllerContainer) ||
    (native && (input.controllerContainer || input.grant))
  )
    return error('upgradeHostInput')
  const stateRoot = fs.lstatSync(input.directory)
  if (
    !stateRoot.isDirectory() ||
    stateRoot.uid !== 0 ||
    (stateRoot.mode & 0o777) !== 0o700
  )
    return error('upgradeHostEnvironment')
  if (
    input.filename &&
    !fs
      .realpathSync(input.filename)
      .startsWith(fs.realpathSync(input.directory) + path.sep)
  )
    return error('upgradeHostTarget')
  if (input.operation === 'status') {
    const result = host.status(input.filename)
    if (
      (input.instanceId && result.instanceId !== input.instanceId) ||
      result.image !== input.image
    )
      return error('upgradeHostTarget')
    return { success: true, ...result }
  }
  let checkpoint
  if (input.operation === 'resume') {
    checkpoint = host.read(input.filename)
    if (
      checkpoint.reviewed.instanceId !== input.instanceId ||
      checkpoint.reviewed.identity.manifest.image !== input.image ||
      checkpoint.reviewed.reviewHash !== input.approval
    )
      return error('upgradeHostTarget')
    input.container = checkpoint.reviewed.containerId
  }
  const current = await docker(
    'GET',
    `/containers/${encodeURIComponent(input.container || 'slipway')}/json`
  )
  let image
  try {
    image = await docker(
      'GET',
      `/images/${encodeURIComponent(input.image)}/json`
    )
  } catch (failure) {
    if (!native) throw failure
    await require('node:util').promisify(
      require('node:child_process').execFile
    )('docker', ['pull', input.image], {
      timeout: 300000,
      maxBuffer: 65536,
      env: { PATH: process.env.PATH }
    })
    image = await docker(
      'GET',
      `/images/${encodeURIComponent(input.image)}/json`
    )
  }
  if (!(image.RepoDigests || []).includes(input.image))
    return error('upgradeHostImage')
  if (native) {
    if (
      !/^[a-f0-9]{40}$/.test(nativeRevision || '') ||
      image.Config.Labels?.['org.opencontainers.image.revision'] !==
        nativeRevision
    )
      return error('upgradeHostImage')
    let probe
    try {
      probe = await docker('POST', '/containers/create', {
        Image: input.image,
        User: '65534',
        Entrypoint: ['node'],
        Cmd: [
          '-e',
          'console.log(JSON.stringify({version:require("/app/package.json").version}))'
        ],
        Tty: true,
        Labels: { 'io.slipway.upgrade.metadata': 'true' },
        HostConfig: {
          NetworkMode: 'none',
          ReadonlyRootfs: true,
          CapDrop: ['ALL'],
          RestartPolicy: { Name: 'no' }
        }
      })
      await docker('POST', `/containers/${probe.Id}/start`)
      const exit = await docker(
        'POST',
        `/containers/${probe.Id}/wait?condition=not-running`
      )
      const metadata = await docker(
        'GET',
        `/containers/${probe.Id}/logs?stdout=1&stderr=0`
      )
      if (exit.StatusCode !== 0 || metadata?.version !== registry.release)
        return error('upgradeHostImage')
    } finally {
      if (probe) await docker('DELETE', `/containers/${probe.Id}?force=1`)
    }
  }
  const mounts = current.Mounts.filter(
    (mount) => mount.Destination === '/app/db'
  )
  if (mounts.length !== 1 || !mounts[0].RW) return error('upgradeHostTarget')
  const sourceDirectory = fs.realpathSync(mounts[0].Source)
  const stat = fs.statSync(sourceDirectory)
  const annotations = Object.fromEntries(
    (current.Config.Env || [])
      .filter((value) => value.startsWith('SLIPWAY_UPGRADE_'))
      .map((value) => {
        const at = value.indexOf('=')
        return [value.slice(0, at), value.slice(at + 1)]
      })
  )
  const instanceId =
    checkpoint?.reviewed.instanceId ||
    annotations.SLIPWAY_UPGRADE_INSTANCE ||
    `slipway:${crypto
      .createHash('sha256')
      .update(
        JSON.stringify({ sourceDirectory, device: stat.dev, inode: stat.ino })
      )
      .digest('hex')}`
  let reviewed
  if (checkpoint) reviewed = checkpoint.reviewed
  else if (input.operation === 'initialize') {
    if (
      current.State.Status !== 'created' ||
      current.Image !== image.Id ||
      current.Config.Labels?.['io.slipway.install.pending'] !== 'true'
    )
      return error('upgradeHostTarget')
    require('./upgrade-fresh-storage')(sourceDirectory)
    reviewed = host.plan({
      sourceDirectory,
      instanceId,
      image: input.image,
      sourceVersion: 'fresh',
      containerId: current.Id,
      containerName: current.Name.replace(/^\//, '')
    })
    input.instanceId = instanceId
    input.approval = reviewed.reviewHash
  } else {
    const command = await docker('POST', `/containers/${current.Id}/exec`, {
      AttachStdout: true,
      AttachStderr: false,
      Tty: true,
      Cmd: [
        'node',
        '-e',
        'console.log(JSON.stringify({version:require("/app/package.json").version}))'
      ]
    })
    const source = await docker('POST', `/exec/${command.Id}/start`, {
      Detach: false,
      Tty: true
    })
    const execution = await docker('GET', `/exec/${command.Id}/json`)
    if (execution.Running || execution.ExitCode !== 0)
      return error('upgradeHostSource')
    let previous
    if (annotations.SLIPWAY_UPGRADE_MARKER) {
      const marker = require('./upgrade-startup').readMarker(
        annotations.SLIPWAY_UPGRADE_MARKER
      )
      require('./upgrade-startup').verify({
        markerFile: annotations.SLIPWAY_UPGRADE_MARKER,
        version: source.version,
        image: annotations.SLIPWAY_UPGRADE_IMAGE,
        instanceId,
        manifestHash: annotations.SLIPWAY_UPGRADE_MANIFEST,
        datastores: Object.fromEntries(
          host
            .services(sourceDirectory, instanceId)
            .map((service) => [
              service.datastore,
              { adapter: 'sails-sqlite', url: service.path }
            ])
        )
      })
      if (current.Config.Image !== annotations.SLIPWAY_UPGRADE_IMAGE)
        return error('upgradeHostSource')
      previous = require('./upgrade-coordinator').readJournal(
        marker.filename
      ).identity
    }
    reviewed = host.plan({
      sourceDirectory,
      instanceId,
      image: input.image,
      sourceVersion: source.version,
      containerId: current.Id,
      containerName: current.Name.replace(/^\//, ''),
      previous
    })
  }
  // Reject unsupported launch topology before freezing or copying storage.
  require('./upgrade-launch-config')({
    current,
    imageConfig: image.Config,
    image: input.image,
    stage: {
      directory: path.join(input.directory, 'preview-stage'),
      dataDirectory: path.join(input.directory, 'preview-stage', 'data')
    },
    marker: path.join(input.directory, 'preview-stage', 'launch.json'),
    instanceId,
    manifestHash: reviewed.identity.hash,
    runId: 'review-only',
    stateRoot: fs.realpathSync(input.directory),
    hostCheckpoint: path.join(
      fs.realpathSync(input.directory),
      'preview-host.json'
    )
  })
  if (input.operation === 'plan') return { success: true, ...reviewed }
  if (input.instanceId !== instanceId || input.approval !== reviewed.reviewHash)
    return error('upgradeHostApproval')
  let actor = { kind: 'host-root', uid: 0, id: 0, team: 0 }
  let authorize
  if (input.grant) {
    const secret = current.Config.Env?.find((value) =>
      value.startsWith('SESSION_SECRET=')
    )?.slice('SESSION_SECRET='.length)
    authorize = () =>
      handoff.verify({
        grant: input.grant,
        secret,
        instanceId,
        reviewHash: reviewed.reviewHash,
        database: path.join(sourceDirectory, 'app.db'),
        consumedNonces: []
      })
    const proof = authorize()
    const nonceFile = path.join(input.directory, `handoff-${proof.nonce}.json`)
    fs.writeFileSync(
      nonceFile,
      JSON.stringify({
        actorUserId: proof.actorUserId,
        instanceId,
        reviewHash: reviewed.reviewHash
      }),
      { mode: 0o600, flag: 'wx' }
    )
    const nonceFd = fs.openSync(nonceFile, 'r')
    try {
      fs.fsyncSync(nonceFd)
    } finally {
      fs.closeSync(nonceFd)
    }
    const rootFd = fs.openSync(input.directory, 'r')
    try {
      fs.fsyncSync(rootFd)
    } finally {
      fs.closeSync(rootFd)
    }
    actor = { kind: 'instance-admin', uid: 0, id: proof.actorUserId, team: 0 }
  }
  const driver = driverFactory({
    docker,
    controllerContainer: native ? undefined : input.controllerContainer,
    hostFileSystem: native ? undefined : '/slipway-host',
    directory: input.directory,
    current,
    imageConfig: image.Config,
    imageId: image.Id,
    actor,
    authorize
  })
  const options = {
    reviewed,
    approval: input.approval,
    directory: input.directory,
    driver,
    timeoutMs,
    maxBytes: input.maxBytes || 10 * 1024 * 1024 * 1024,
    reserveBytes
  }
  try {
    if (input.operation === 'prepare') {
      const accepted = host.prepare(options)
      return { success: true, ...accepted }
    }
    if (healthOverride) driver.health = healthOverride
    if (!checkpoint && native) {
      const accepted = host.prepare(options)
      if (onCheckpoint) await onCheckpoint(accepted)
      input.filename = accepted.filename
      checkpoint = host.read(accepted.filename)
    }
    const result = checkpoint
      ? await host.resume({
          filename: input.filename,
          expectedReviewHash: input.approval,
          driver,
          timeoutMs: options.timeoutMs
        })
      : await host.apply(options)
    return { success: true, ...result }
  } catch (failure) {
    return {
      success: false,
      code: /^upgrade[A-Za-z]+$/.test(failure.code || '')
        ? failure.code
        : 'upgradeHostRecoveryRequired',
      filename: failure.filename || input.filename || null,
      instanceId,
      reason: require('./upgrade-fence-reasons').has(failure.reason)
        ? failure.reason
        : undefined,
      recoveryRequired: true
    }
  }
}

module.exports = { run, officialImage }
