const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const containerProof = require('./image-guard-container')

// No age-based expiry. Unverifiable owners and cleanup holds stay closed.
// Container receipts extend process proof across container replacement.
function create({ identity = selfIdentity, state = ownerState } = {}) {
  async function acquire(appPath, mode = 'use', { recovery } = {}) {
    if (!['use', 'cleanup'].includes(mode))
      throw new Error('Invalid guard mode')
    const root = path.join(appPath, 'db', 'image-operation-guard')
    await fs.mkdir(root, { recursive: true, mode: 0o700 })
    const owner = await identity()
    const record = {
      version: owner?.container ? 3 : 2,
      token: randomUUID(),
      mode,
      pid: process.pid,
      startedAt: Date.now(),
      owner
    }
    // Slow inventory stays outside admission. Re-read both ownership and durable
    // activity inside admission before moving any proved-dead use marker.
    let prepared = null
    if (mode === 'cleanup' && recovery) {
      const candidates = await deadUses(root, owner)
      if (candidates && (await recovery.prepare())) prepared = candidates
    }
    let marker, raw
    let recoveredCount = 0
    await admitted(root, async () => {
      const entries = await fs.readdir(root)
      if (entries.includes('cleanup')) throw busy('image-cleanup-guard-present')
      if (
        entries.some(
          (name) =>
            name !== 'admission' &&
            name !== 'cleanup' &&
            !/^use-[a-f0-9-]{36}$/.test(name)
        )
      )
        throw busy('image-guard-inventory-unverified')
      const uses = entries.filter((name) => name.startsWith('use-'))
      if (mode === 'cleanup' && uses.length) {
        const current = prepared && (await deadUses(root, owner))
        if (
          !current ||
          JSON.stringify(current) !== JSON.stringify(prepared) ||
          !(await boundedVerify(recovery.verify))
        )
          throw busy('image-use-guard-present')
        marker = path.join(root, 'cleanup')
        raw = JSON.stringify(record)
        await fs.writeFile(marker, raw, { flag: 'wx', mode: 0o600 })
        try {
          await quarantine(appPath, current, record.token)
          recoveredCount = current.length
        } catch (error) {
          // A partial rollback retains exclusion for operator inspection.
          if (error.restored) await fs.unlink(marker)
          throw error
        }
      } else {
        marker = path.join(
          root,
          mode === 'cleanup' ? 'cleanup' : `use-${record.token}`
        )
        raw = JSON.stringify(record)
        await fs.writeFile(marker, raw, { flag: 'wx', mode: 0o600 })
      }
    })
    const release = async () => {
      await admitted(root, async () => {
        if ((await fs.readFile(marker, 'utf8')) !== raw)
          throw new Error('Image guard ownership changed; hold preserved.')
        await fs.unlink(marker)
      })
    }
    release.recoveredCount = recoveredCount
    return release
  }
  async function readUses(root, owner) {
    const names = (await fs.readdir(root)).filter(
      (name) => name !== 'admission'
    )
    if (
      !names.length ||
      names.length > 100 ||
      names.some((name) => !/^use-[a-f0-9-]{36}$/.test(name))
    )
      return null
    const result = []
    const deadline = Date.now() + 5000
    for (const name of names.sort()) {
      try {
        if (Date.now() >= deadline) return null
        const file = path.join(root, name)
        const stat = await fs.lstat(file)
        if (!stat.isFile() || stat.size > 4096) return null
        const raw = await fs.readFile(file, 'utf8')
        const record = JSON.parse(raw)
        if (record.token !== name.slice(4)) return null
        let timer
        let classification
        try {
          classification = await Promise.race([
            state(record, owner),
            new Promise((resolve) => {
              timer = setTimeout(
                () => resolve('unknown'),
                Math.max(1, deadline - Date.now())
              )
            })
          ])
        } finally {
          clearTimeout(timer)
        }
        result.push({ name, raw, state: classification })
      } catch {
        return null
      }
    }
    return result
  }
  async function deadUses(root, owner) {
    const records = await readUses(root, owner)
    return records?.every((record) => record.state === 'dead')
      ? records.map(({ name, raw }) => ({ name, raw }))
      : null
  }
  async function inspect(appPath) {
    const root = path.join(appPath, 'db', 'image-operation-guard')
    try {
      const names = await fs.readdir(root)
      if (!names.length) return { state: 'clear', count: 0 }
      if (names.includes('admission'))
        return { state: 'busy', count: names.length }
      if (names.includes('cleanup'))
        return { state: 'cleanup', count: names.length }
      const owner = await identity()
      const records = await readUses(root, owner)
      if (records?.every((record) => record.state === 'dead'))
        return { state: 'recoverable', count: records.length }
      if (records?.every((record) => ['dead', 'live'].includes(record.state)))
        return { state: 'active', count: records.length }
      return { state: 'unverified', count: names.length }
    } catch (error) {
      if (error.code === 'ENOENT') return { state: 'clear', count: 0 }
      return { state: 'unverified', count: null }
    }
  }
  function guard(fn) {
    return async function (...args) {
      const release = await acquire(sails.config.appPath)
      try {
        return await fn.apply(this, args)
      } finally {
        await release()
      }
    }
  }
  return { acquire, guard, inspect }
}

async function admitted(root, fn) {
  const admission = path.join(root, 'admission')
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.mkdir(admission)
      break
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      if (attempt >= 100) throw busy('image-admission-guard-busy')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  try {
    return await fn()
  } finally {
    await fs.rmdir(admission)
  }
}
async function quarantine(appPath, records, token) {
  const root = path.join(appPath, 'db', 'image-operation-guard')
  const directory = path.join(appPath, 'db', 'image-guard-retired', token)
  const moved = []
  try {
    const parent = path.dirname(directory)
    await fs.mkdir(parent, { recursive: true, mode: 0o700 })
    const parentStat = await fs.lstat(parent)
    if (!parentStat.isDirectory() || (parentStat.mode & 0o077) !== 0)
      throw new Error('Image guard quarantine directory is not private.')
    await fs.mkdir(directory, { mode: 0o700 })
    const manifest = await fs.open(
      path.join(directory, 'manifest.json'),
      'wx',
      0o600
    )
    try {
      await manifest.writeFile(
        JSON.stringify({
          version: 1,
          token,
          reason: 'proved-dead-use-owner',
          state: 'prepared',
          createdAt: Date.now(),
          records
        })
      )
      await manifest.sync()
    } finally {
      await manifest.close()
    }
    for (const record of records) {
      await fs.rename(
        path.join(root, record.name),
        path.join(directory, record.name)
      )
      moved.push(record)
    }
    await fs.writeFile(
      path.join(directory, 'complete.json'),
      JSON.stringify({
        token,
        state: 'quarantined',
        finishedAt: Date.now(),
        count: moved.length
      }),
      { flag: 'wx', mode: 0o600 }
    )
  } catch (error) {
    let restored = true
    for (const record of moved.reverse()) {
      try {
        try {
          await fs.lstat(path.join(root, record.name))
          restored = false
          continue
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
        }
        await fs.rename(
          path.join(directory, record.name),
          path.join(root, record.name)
        )
      } catch {
        restored = false
      }
    }
    throw Object.assign(
      new Error('Image guard recovery failed; inspect retained records.'),
      {
        restored,
        code: restored
          ? 'E_IMAGE_GUARD_RECOVERY_FAILED'
          : 'E_IMAGE_OPERATIONS_BUSY',
        reason: 'image-guard-recovery-incomplete'
      }
    )
  }
}
async function boundedVerify(verify) {
  if (typeof verify !== 'function') return false
  let timer
  try {
    return (
      (await Promise.race([
        verify(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 2000)
        })
      ])) === true
    )
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
let containerIdentity
async function selfIdentity() {
  try {
    const identity = {
      bootId: (
        await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')
      ).trim(),
      namespace: await fs.readlink('/proc/self/ns/pid'),
      startTicks: startTicks(await fs.readFile('/proc/self/stat', 'utf8'))
    }
    containerIdentity ||= containerProof.identify(identity, process.pid)
    const container = await containerIdentity
    if (container) identity.container = container
    return identity
  } catch {
    return null
  }
}
function startTicks(stat) {
  return stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/)[19]
}
async function ownerState(
  record,
  current,
  readProcess = (pid) => fs.readFile(`/proc/${pid}/stat`, 'utf8'),
  containers = containerProof
) {
  const owner = record?.owner
  if (
    ![2, 3].includes(record?.version) ||
    (record.version === 3 && !containers.valid(record.owner?.container)) ||
    record.mode !== 'use' ||
    !/^[a-f0-9-]{36}$/.test(record.token || '') ||
    !Number.isSafeInteger(record.pid) ||
    record.pid < 1 ||
    !Number.isSafeInteger(record.startedAt) ||
    record.startedAt < 1 ||
    !owner ||
    !current ||
    !/^[a-f0-9-]{36}$/.test(owner.bootId || '') ||
    !/^pid:\[[0-9]+\]$/.test(owner.namespace || '') ||
    !/^[0-9]+$/.test(owner.startTicks || '')
  )
    return 'unknown'
  if (
    owner.bootId !== current.bootId ||
    owner.namespace !== current.namespace ||
    (record.version === 3 &&
      (owner.container.id !== current.container?.id ||
        owner.container.startedAt !== current.container?.startedAt ||
        owner.container.daemonId !== current.container?.daemonId))
  )
    return record.version === 3 ? containers.state(record, current) : 'unknown'
  try {
    const ticks = startTicks(await readProcess(record.pid))
    if (!/^[0-9]+$/.test(ticks || '')) return 'unknown'
    return ticks === owner.startTicks ? 'live' : 'dead'
  } catch (error) {
    return error.code === 'ENOENT' ? 'dead' : 'unknown'
  }
}
function busy(reason) {
  return Object.assign(
    new Error(
      'Image operations are busy; retry after deployment or maintenance completes.'
    ),
    { code: 'E_IMAGE_OPERATIONS_BUSY', reason }
  )
}
module.exports = { ...create(), _private: { create, ownerState, startTicks } }
