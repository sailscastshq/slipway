const fs = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const { digest } = require('./upgrade-ledger')
function containerSnapshotHash(state) {
  // Docker builds Mounts from a map; ordering is not a change in mounts.
  // Compare every field and every mount, including duplicates and RW policy.
  return digest({
    ...state,
    mounts: [...state.mounts].sort((first, second) =>
      digest(first).localeCompare(digest(second))
    )
  })
}
function fail(reason) {
  throw Object.assign(
    new Error('All database writers could not be observed.'),
    {
      code: 'upgradeFenceUnproved',
      reason
    }
  )
}
function processIdentity(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
  return {
    pid: Number(pid),
    start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
    boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
  }
}
function sameProcess(first, second) {
  return (
    !!first &&
    !!second &&
    first.pid === second.pid &&
    first.start === second.start &&
    first.boot === second.boot
  )
}
function deviceParts(number) {
  const device = BigInt(number)
  return [
    Number(((device >> 8n) & 0xfffn) | ((device >> 32n) & 0xfffff000n)),
    Number((device & 0xffn) | ((device >> 12n) & 0xffffff00n))
  ]
}
function overlap(first, second) {
  return first === second || first.startsWith(second + path.sep)
}
async function observeWriters({
  databases,
  controller,
  hostPidNamespace,
  worker,
  controllerContainer,
  storageDirectories = [],
  hostFileSystem,
  timeoutMs = 10000
}) {
  if (process.platform !== 'linux' || process.getuid() !== 0) fail()
  // The privileged host launcher supplies its trusted PID namespace identity.
  // A container-local /proc inventory must never pass as a host-wide scan.
  if (
    !hostPidNamespace ||
    fs.readlinkSync('/proc/self/ns/pid') !== hostPidNamespace
  )
    fail()
  if (hostFileSystem) {
    // The driver verifies native Docker PidMode=host, native controller PID,
    // and the exact read-only '/' bind. Distinct procfs mounts have distinct
    // device identities even in that same PID namespace. Bind file identities
    // below using the actual protected datastores instead.
    if (!path.isAbsolute(hostFileSystem)) fail()
  }
  if (!Array.isArray(databases) || !databases.length) fail()
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) fail()
  const deadline = Date.now() + timeoutMs
  function remaining() {
    const value = deadline - Date.now()
    if (value <= 0) fail()
    return value
  }
  // A PID alone is insufficient: require boot and native start identity.
  if (!sameProcess(controller, processIdentity(controller?.pid)))
    fail('controllerIdentity')
  if (worker) {
    if (!sameProcess(worker, processIdentity(worker.pid)))
      fail('workerIdentity')
    const stat = fs.readFileSync(`/proc/${worker.pid}/stat`, 'utf8')
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1])
    if (parent !== controller.pid || worker.boot !== controller.boot)
      fail('workerParent')
  }
  const targets = databases.map((database) => {
    const filename = fs.realpathSync(database.path)
    const hostFilename = hostFileSystem
      ? fs.realpathSync(path.join(hostFileSystem, filename))
      : filename
    if (hostFileSystem) {
      for (const suffix of ['', '-wal', '-shm']) {
        if (
          fs.existsSync(filename + suffix) !==
          fs.existsSync(hostFilename + suffix)
        )
          fail('storageTopology')
        if (!fs.existsSync(filename + suffix)) continue
        const native = fs.statSync(filename + suffix, { bigint: true })
        const view = fs.statSync(hostFilename + suffix, { bigint: true })
        if (native.dev !== view.dev || native.ino !== view.ino)
          fail('storageTopology')
      }
    }
    const files = [filename, filename + '-wal', filename + '-shm']
      .filter((item) => fs.existsSync(item))
      .map((item) => fs.statSync(item, { bigint: true }))
    return {
      databaseKey: database.databaseKey,
      filename,
      hostFilename,
      files
    }
  })
  if (
    new Set(targets.map((item) => item.databaseKey)).size !== targets.length ||
    new Set(targets.map((item) => item.filename)).size !== targets.length
  )
    fail()
  const extraFiles = []
  function inventoryStorage(directory) {
    remaining()
    for (const name of fs.readdirSync(directory)) {
      remaining()
      const filename = path.join(directory, name)
      const stat = fs.lstatSync(filename, { bigint: true })
      if (stat.isSymbolicLink()) fail('storageTopology')
      if (stat.isDirectory()) inventoryStorage(filename)
      else if (stat.isFile()) {
        if (extraFiles.length >= 100000) fail()
        extraFiles.push(stat)
      } else fail('storageTopology')
    }
  }
  if (!Array.isArray(storageDirectories) || storageDirectories.length > 8)
    fail()
  for (const directory of storageDirectories)
    inventoryStorage(fs.realpathSync(directory))
  const protectedFiles = [
    ...targets.flatMap((target) => target.files),
    ...extraFiles
  ]
  const matches = (stat) =>
    protectedFiles.some(
      (file) => file.dev === stat.dev && file.ino === stat.ino
    )
  async function docker(...args) {
    try {
      const result = await execute('docker', args, {
        timeout: remaining(),
        maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH }
      })
      return result.stdout
    } catch {
      fail()
    }
  }
  const ids = (await docker('container', 'ls', '-aq', '--no-trunc'))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  const containers = []
  const inventory = []
  for (const id of ids) {
    if (!/^[a-f0-9]{64}$/.test(id)) fail()
    // Inspect only non-secret state and mounts; never collect Env or Args.
    const state = JSON.parse(
      await docker(
        'inspect',
        '--format',
        '{"id":{{json .Id}},"pid":{{json .State.Pid}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},"restart":{{json .HostConfig.RestartPolicy.Name}},"mounts":{{json .Mounts}}}',
        id
      )
    )
    inventory.push(state)
    if (state.id === controllerContainer) {
      if (
        state.pid !== controller.pid ||
        !state.running ||
        state.paused ||
        state.restarting ||
        state.restart !== 'no'
      )
        fail('activeContainer')
      continue
    }
    const relevant = state.mounts.some((mount) => {
      if (mount.RW === false) return false
      let source
      try {
        source = fs.realpathSync(
          hostFileSystem
            ? path.join(hostFileSystem, mount.Source)
            : mount.Source
        )
      } catch {
        // An unobservable mount cannot be classified safely.
        fail()
      }
      return targets.some((target) => overlap(target.hostFilename, source))
    })
    if (relevant) {
      if (
        state.running ||
        state.paused ||
        state.restarting ||
        state.restart !== 'no'
      )
        fail('activeContainer')
      containers.push(state.id)
    }
  }
  for (const pid of fs
    .readdirSync('/proc')
    .filter((item) => /^\d+$/.test(item))) {
    remaining()
    try {
      const before = processIdentity(pid)
      if (sameProcess(controller, before) || sameProcess(worker, before))
        continue
      for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
        remaining()
        try {
          if (matches(fs.statSync(`/proc/${pid}/fd/${fd}`, { bigint: true })))
            fail('openHandle')
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
      }
      for (const line of fs
        .readFileSync(`/proc/${pid}/maps`, 'utf8')
        .split('\n')) {
        const fields = line.trim().split(/\s+/)
        if (!fields[4] || fields[4] === '0') continue
        const [major, minor] = fields[3]
          .split(':')
          .map((value) => parseInt(value, 16))
        if (
          protectedFiles.some((file) => {
            const parts = deviceParts(file.dev)
            return (
              file.ino === BigInt(fields[4]) &&
              parts[0] === major &&
              parts[1] === minor
            )
          })
        )
          fail('memoryMapping')
      }
      if (!sameProcess(before, processIdentity(pid))) fail('processChanged')
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH')
        fail(
          error.code === 'upgradeFenceUnproved'
            ? error.reason
            : 'procUnobservable'
        )
    }
  }
  // Recheck the full inventory: a new container during observation blocks.
  const finalIds = (await docker('container', 'ls', '-aq', '--no-trunc'))
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (JSON.stringify(ids.sort()) !== JSON.stringify(finalIds.sort()))
    fail('inventoryChanged')
  for (const state of inventory) {
    const current = JSON.parse(
      await docker(
        'inspect',
        '--format',
        '{"id":{{json .Id}},"pid":{{json .State.Pid}},"running":{{json .State.Running}},"paused":{{json .State.Paused}},"restarting":{{json .State.Restarting}},"restart":{{json .HostConfig.RestartPolicy.Name}},"mounts":{{json .Mounts}}}',
        state.id
      )
    )
    if (containerSnapshotHash(current) !== containerSnapshotHash(state))
      fail('inventoryChanged')
  }
  return {
    writersStopped: true,
    databaseKeys: targets.map((target) => target.databaseKey),
    stoppedContainers: containers,
    controller
  }
}
// This is an observation, not exclusion of future launches. The caller must
// separately enforce exclusive Docker AND host writer control throughout the
// backup/DDL window. Never set exclusiveController from this result alone.
module.exports = {
  observeWriters,
  processIdentity,
  sameProcess,
  containerSnapshotHash
}
