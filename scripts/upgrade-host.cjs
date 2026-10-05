#!/usr/bin/env node
// Fixed target-image program for the root host launcher. Input is private stdin;
// output contains plan/status/error metadata only. Never lift Sails here.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const host = require('../api/lib/upgrade-host-controller')
const docker = require('../api/lib/upgrade-docker-api')()
const driverFactory = require('../api/lib/upgrade-host-driver')
const registry = require('../api/lib/upgrade-registry')
const handoff = require('../api/lib/upgrade-handoff')
async function readInput() {
  const chunks = []
  let bytes = 0
  for await (const chunk of process.stdin) {
    bytes += chunk.length
    if (bytes > 1024 * 1024) throw new Error('Input too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString())
}
function error(code) {
  process.stdout.write(
    JSON.stringify({ success: false, code, recoveryRequired: true }) + '\n'
  )
  process.exitCode = 1
}
async function main() {
  if (
    process.platform !== 'linux' ||
    process.getuid() !== 0 ||
    require('../package.json').version !== registry.release
  )
    return error('upgradeHostEnvironment')
  const input = await readInput()
  if (
    !['plan', 'apply', 'status', 'resume'].includes(input.operation) ||
    !/^ghcr\.io\/sailscastshq\/slipway@sha256:[a-f0-9]{64}$/.test(
      input.image || ''
    ) ||
    !path.isAbsolute(input.directory || '') ||
    !input.controllerContainer
  )
    return error('upgradeHostInput')
  const stateRoot = fs.lstatSync(input.directory)
  if (
    !stateRoot.isDirectory() ||
    stateRoot.uid !== 0 ||
    (stateRoot.mode & 0o777) !== 0o700
  )
    return error('upgradeHostEnvironment')
  if (input.operation === 'status') {
    const result = host.status(input.filename)
    if (result.instanceId !== input.instanceId || result.image !== input.image)
      return error('upgradeHostTarget')
    return process.stdout.write(
      JSON.stringify({ success: true, ...result }) + '\n'
    )
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
  const image = await docker(
    'GET',
    `/images/${encodeURIComponent(input.image)}/json`
  )
  if (!(image.RepoDigests || []).includes(input.image))
    return error('upgradeHostImage')
  const mounts = current.Mounts.filter(
    (mount) => mount.Destination === '/app/db'
  )
  if (mounts.length !== 1 || !mounts[0].RW) return error('upgradeHostTarget')
  const sourceDirectory = fs.realpathSync(mounts[0].Source)
  const stat = fs.statSync(sourceDirectory)
  const instanceId =
    checkpoint?.reviewed.instanceId ||
    `slipway:${crypto
      .createHash('sha256')
      .update(
        JSON.stringify({ sourceDirectory, device: stat.dev, inode: stat.ino })
      )
      .digest('hex')}`
  let reviewed
  if (checkpoint) reviewed = checkpoint.reviewed
  else {
    const command = await docker('POST', `/containers/${current.Id}/exec`, {
      AttachStdout: true,
      AttachStderr: false,
      Tty: true,
      Cmd: [
        'node',
        '-e',
        'console.log(JSON.stringify({version:require("./package.json").version}))'
      ]
    })
    const source = await docker('POST', `/exec/${command.Id}/start`, {
      Detach: false,
      Tty: true
    })
    const execution = await docker('GET', `/exec/${command.Id}/json`)
    if (execution.Running || execution.ExitCode !== 0)
      return error('upgradeHostSource')
    reviewed = host.plan({
      sourceDirectory,
      instanceId,
      image: input.image,
      sourceVersion: source.version,
      containerId: current.Id,
      containerName: current.Name.replace(/^\//, '')
    })
  }
  // Reject unsupported launch topology before freezing or copying storage.
  require('../api/lib/upgrade-launch-config')({
    current,
    imageConfig: image.Config,
    image: input.image,
    stage: {
      directory: input.directory,
      dataDirectory: path.join(input.directory, 'preview-data')
    },
    marker: path.join(input.directory, 'preview-marker'),
    instanceId,
    manifestHash: reviewed.identity.hash,
    runId: 'review-only'
  })
  if (input.operation === 'plan')
    return process.stdout.write(
      JSON.stringify({ success: true, ...reviewed }) + '\n'
    )
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
    controllerContainer: input.controllerContainer,
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
    timeoutMs: 20 * 60 * 1000,
    maxBytes: input.maxBytes || 10 * 1024 * 1024 * 1024,
    reserveBytes: 1024 * 1024 * 1024
  }
  try {
    const result = checkpoint
      ? await host.resume({
          filename: input.filename,
          expectedReviewHash: input.approval,
          driver,
          timeoutMs: options.timeoutMs
        })
      : await host.apply(options)
    process.stdout.write(JSON.stringify({ success: true, ...result }) + '\n')
  } catch (failure) {
    process.stdout.write(
      JSON.stringify({
        success: false,
        code: /^upgrade[A-Za-z]+$/.test(failure.code || '')
          ? failure.code
          : 'upgradeHostRecoveryRequired',
        filename: failure.filename || input.filename || null,
        instanceId,
        recoveryRequired: true
      }) + '\n'
    )
    process.exitCode = 1
  }
}
main().catch(() => error('upgradeHostRecoveryRequired'))
