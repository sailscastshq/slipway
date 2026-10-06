const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const host = require('./upgrade-host-controller')
const handoff = require('./upgrade-handoff')
function fail(code = 'upgradeDispatchUnconfirmed') {
  throw Object.assign(
    new Error(
      'Upgrade dispatch requires its reviewed checkpoint and instance authority.'
    ),
    { code }
  )
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
module.exports = function createBroker({
  docker = require('./upgrade-docker-api')(),
  directory = process.env.SLIPWAY_UPGRADE_STATE_ROOT,
  container = process.env.SLIPWAY_UPGRADE_CONTAINER,
  instanceId = process.env.SLIPWAY_UPGRADE_INSTANCE,
  secret = process.env.SESSION_SECRET,
  actor,
  timeoutMs = 90000
} = {}) {
  if (!directory || !container || !instanceId) fail('upgradeHostRequired')
  if (
    !actor?.isGenesisUser ||
    !Number.isSafeInteger(actor.id) ||
    typeof actor.authVersion !== 'string'
  )
    fail('upgradeHandoffRejected')
  const root = fs.realpathSync(directory)
  const stat = fs.lstatSync(root)
  if (
    !stat.isDirectory() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o700
  )
    fail('upgradeHostEnvironment')
  function validateImage(image) {
    if (
      !/^ghcr\.io\/sailscastshq\/slipway@sha256:[a-f0-9]{64}$/.test(image || '')
    )
      fail('upgradeHostImage')
  }
  async function create(input) {
    validateImage(input.image)
    const name = 'slipway-upgrade-controller-' + crypto.randomUUID()
    const filename = path.join(root, 'request-' + crypto.randomUUID() + '.json')
    const request = {
      ...input,
      container,
      directory: root,
      controllerContainer: name
    }
    fs.writeFileSync(filename, JSON.stringify(request), {
      mode: 0o600,
      flag: 'wx'
    })
    let created
    try {
      created = await docker(
        'POST',
        `/containers/create?name=${encodeURIComponent(name)}`,
        {
          Image: input.image,
          User: '0',
          Entrypoint: ['node'],
          Cmd: ['scripts/upgrade-host.cjs', '--request-file', filename],
          WorkingDir: '/app',
          Tty: true,
          Labels: {
            'io.slipway.upgrade.controller': name,
            'io.slipway.upgrade.instance': instanceId
          },
          HostConfig: {
            NetworkMode: 'none',
            PidMode: 'host',
            CapAdd: ['SYS_PTRACE'],
            RestartPolicy: { Name: 'no' },
            Mounts: [
              {
                Type: 'bind',
                Source: '/',
                Target: '/slipway-host',
                ReadOnly: true,
                BindOptions: { Propagation: 'rslave' }
              },
              {
                Type: 'bind',
                Source: '/var/run/docker.sock',
                Target: '/var/run/docker.sock',
                ReadOnly: false
              },
              { Type: 'bind', Source: root, Target: root, ReadOnly: false }
            ]
          }
        },
        timeoutMs
      )
    } catch {
      fs.rmSync(filename, { force: true })
      fail()
    }
    return { id: created.Id, filename, name }
  }
  async function discard(created) {
    await docker(
      'DELETE',
      `/containers/${created.id}?force=1`,
      undefined,
      timeoutMs
    )
    fs.rmSync(created.filename, { force: true })
  }
  async function invoke(input) {
    const created = await create(input)
    try {
      await docker(
        'POST',
        `/containers/${created.id}/start`,
        undefined,
        timeoutMs
      )
      const exit = await docker(
        'POST',
        `/containers/${created.id}/wait?condition=not-running`,
        undefined,
        timeoutMs
      )
      const result = await docker(
        'GET',
        `/containers/${created.id}/logs?stdout=1&stderr=0`,
        undefined,
        timeoutMs
      )
      if (exit.StatusCode !== 0 || result?.success !== true)
        fail(
          /^upgrade[A-Za-z]+$/.test(result?.code || '')
            ? result.code
            : undefined
        )
      return result
    } finally {
      await discard(created)
    }
  }
  function grant(reviewHash) {
    return handoff.sign({
      secret,
      actorUserId: actor.id,
      authVersion: actor.authVersion,
      instanceId,
      reviewHash
    })
  }
  function metadata(id) {
    if (!uuid.test(id || '')) fail('upgradeHostTarget')
    const filename = path.join(root, `dispatch-${id}.json`)
    const stat = fs.lstatSync(filename)
    if (
      !stat.isFile() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600 ||
      stat.size > 65536
    )
      fail('upgradeHostTarget')
    const value = JSON.parse(fs.readFileSync(filename, 'utf8'))
    if (
      value.instanceId !== instanceId ||
      !fs.realpathSync(value.filename).startsWith(root + path.sep)
    )
      fail('upgradeHostTarget')
    return value
  }
  async function accepted(input, existingId) {
    const id = existingId || crypto.randomUUID()
    const created = await create({
      operation: 'resume',
      image: input.image,
      filename: input.filename,
      instanceId,
      approval: input.reviewHash,
      grant: grant(input.reviewHash)
    })
    const record = {
      id,
      filename: input.filename,
      instanceId,
      image: input.image,
      reviewHash: input.reviewHash,
      controllerId: created.id,
      phase: 'accepted',
      manifestHash: input.manifestHash,
      targetVersion: input.targetVersion
    }
    const filename = path.join(root, `dispatch-${id}.json`)
    const temporary = filename + '.' + crypto.randomUUID()
    fs.writeFileSync(temporary, JSON.stringify(record), {
      mode: 0o600,
      flag: 'wx'
    })
    const fd = fs.openSync(temporary, 'r')
    try {
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    fs.renameSync(temporary, filename)
    const dirfd = fs.openSync(root, 'r')
    try {
      fs.fsyncSync(dirfd)
    } finally {
      fs.closeSync(dirfd)
    }
    let started = false
    return {
      result: { status: 'accepted', ...record },
      async start() {
        if (started) return
        started = true
        await docker(
          'POST',
          `/containers/${created.id}/start`,
          undefined,
          timeoutMs
        )
      },
      async cancel() {
        if (!started) await discard(created)
      }
    }
  }
  return {
    async start(id) {
      const value = metadata(id)
      const state = host.read(value.filename)
      if (state.phase === 'ready') return
      const controller = await docker(
        'GET',
        `/containers/${value.controllerId}/json`,
        undefined,
        timeoutMs
      )
      if (
        controller.Config?.Labels?.['io.slipway.upgrade.instance'] !==
          instanceId ||
        controller.Config?.Labels?.['io.slipway.upgrade.controller'] !==
          controller.Name?.replace(/^\//, '')
      )
        fail('upgradeHostTarget')
      if (controller.State.Running) return
      if (controller.State.Status !== 'created')
        fail('upgradeDispatchUnconfirmed')
      await docker(
        'POST',
        `/containers/${value.controllerId}/start`,
        undefined,
        timeoutMs
      )
    },
    async plan(image) {
      const result = await invoke({ operation: 'plan', image })
      if (result.instanceId !== instanceId) fail('upgradeHostTarget')
      return result
    },
    async apply({ image, approval, requestedInstance }) {
      if (
        requestedInstance !== instanceId ||
        !/^[a-f0-9]{64}$/.test(approval || '')
      )
        fail('upgradeHostApproval')
      const reviewed = await invoke({ operation: 'plan', image })
      if (
        reviewed.instanceId !== instanceId ||
        reviewed.reviewHash !== approval
      )
        fail('upgradeHostApproval')
      const prepared = await invoke({
        operation: 'prepare',
        image,
        instanceId,
        approval,
        grant: grant(approval)
      })
      return accepted({ ...prepared, image })
    },
    async resume(id, { approval, requestedInstance }) {
      const previous = metadata(id)
      if (requestedInstance !== instanceId || approval !== previous.reviewHash)
        fail('upgradeHostApproval')
      const state = host.read(previous.filename)
      if (
        state.reviewed.instanceId !== instanceId ||
        state.reviewed.reviewHash !== approval ||
        state.phase === 'ready'
      )
        fail('upgradeHostTarget')
      return accepted(previous, id)
    },
    latest() {
      const files = fs
        .readdirSync(root)
        .filter((name) => /^dispatch-[a-f0-9-]{36}\.json$/.test(name))
      if (files.length > 1000) fail('upgradeHostTarget')
      const latest = files
        .map((name) => ({
          name,
          modified: fs.lstatSync(path.join(root, name)).mtimeMs
        }))
        .sort((first, second) => second.modified - first.modified)[0]
      return latest ? this.status(latest.name.slice(9, -5)) : null
    },
    status(id) {
      const previous = metadata(id)
      const native = host.status(previous.filename)
      return {
        ...native,
        id,
        runId: native.id,
        controllerId: previous.controllerId
      }
    }
  }
}
