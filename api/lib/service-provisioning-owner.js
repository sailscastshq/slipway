const fs = require('node:fs/promises')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
const instance = require('node:crypto').randomUUID()
const startedAt = Date.now() - process.uptime() * 1000
const ticks = (stat) =>
  stat
    .slice(stat.lastIndexOf(')') + 2)
    .trim()
    .split(/\s+/)[19]

async function inspect(name) {
  try {
    const { stdout } = await exec(
      sails.config.docker?.binaryPath || 'docker',
      ['inspect', '--type', 'container', name],
      { timeout: 5000, maxBuffer: 256 * 1024 }
    )
    const [c] = JSON.parse(stdout)
    return {
      id: c.Id,
      hostname: c.Config?.Hostname,
      running: c.State?.Running,
      startedAt: c.State?.StartedAt
    }
  } catch (error) {
    if (/no such (?:object|container)/i.test(error.stderr || '')) return null
    throw new Error('Cannot verify the provisioning owner container.')
  }
}
async function current() {
  const owner = { instance, pid: process.pid, startedAt }
  try {
    owner.boot = (
      await fs.readFile('/proc/sys/kernel/random/boot_id', 'utf8')
    ).trim()
    owner.namespace = await fs.readlink('/proc/self/ns/pid')
    owner.ticks = ticks(await fs.readFile('/proc/self/stat', 'utf8'))
    const container = await inspect('slipway')
    if (container?.running && container.hostname === os.hostname()) {
      owner.container = container
      // The normal installer stops the old coordinator before publishing this one.
      // A retained live coordinator makes legacy, ownerless recovery ambiguous.
      const previous = await inspect('slipway-previous')
      owner.legacySafe = !previous?.running
    }
  } catch {
    /* Local development can provision, but cannot prove legacy recovery. */
  }
  return owner
}
async function dead(
  owner,
  self,
  {
    readProcess = (pid) => fs.readFile(`/proc/${pid}/stat`, 'utf8'),
    inspectContainer = inspect
  } = {}
) {
  if (!owner || owner.instance === instance) return false
  if (
    owner.boot &&
    owner.boot === self.boot &&
    owner.namespace === self.namespace &&
    /^[0-9]+$/.test(owner.ticks || '') &&
    Number.isSafeInteger(owner.pid) &&
    owner.pid > 0
  ) {
    try {
      const value = ticks(await readProcess(owner.pid))
      return /^[0-9]+$/.test(value || '') && value !== owner.ticks
    } catch (error) {
      return error.code === 'ENOENT'
    }
  }
  // A changed verified Docker runtime generation proves its old processes gone.
  // Cross-namespace owners with the same still-running generation stay closed.
  if (owner.container?.id && self.container) {
    const container = await inspectContainer(owner.container.id)
    return (
      !container ||
      !container.running ||
      container.startedAt !== owner.container.startedAt
    )
  }
  return false
}
function legacyInterrupted(service, self) {
  return Boolean(
    Number.isFinite(service.createdAt) &&
      service.createdAt > 0 &&
      self.legacySafe === true &&
      self.container?.running &&
      Number.isFinite(Date.parse(self.container.startedAt)) &&
      service.createdAt < Date.parse(self.container.startedAt)
  )
}
module.exports = { current, dead, legacyInterrupted, _private: { ticks } }
