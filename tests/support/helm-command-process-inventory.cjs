// Test-only preload for the ordinary Node subprocess fixtures. It changes only
// /proc directory enumeration, giving this fixture the controlled inventory an
// isolated container has. Process metadata, environment reads and signals stay
// real. Production and Docker contract runners never load this file.
const fs = require('node:fs')
const path = require('node:path')
const childProcess = require('node:child_process')
const { randomUUID } = require('node:crypto')
const inventory = process.env.SLIPWAY_HELM_TEST_PROCESS_INVENTORY
if (!inventory || !path.isAbsolute(inventory)) {
  throw new Error('The Helm process fixture requires its private inventory.')
}
const readdir = fs.readdirSync.bind(fs)
const readFile = fs.readFileSync.bind(fs)
const validTicks = (value) =>
  typeof value === 'string' && value.length > 0 && !/\D/.test(value)
const ticksFor = (pid) => {
  const stat = readFile(`/proc/${pid}/stat`, 'utf8')
  const ticks = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)[19]
  if (!validTicks(ticks)) throw invalidIdentity(pid)
  return ticks
}
function invalidIdentity(pid) {
  return Object.assign(
    new Error(`Invalid Helm fixture process identity for PID ${pid}.`),
    {
      code: 'HELM_FIXTURE_IDENTITY_INVALID'
    }
  )
}
function register(pid) {
  let ticks
  try {
    ticks = ticksFor(pid)
  } catch (error) {
    if (!['ENOENT', 'ESRCH'].includes(error.code)) throw error
    // A child may already have exited before spawn() returns.
    return
  }
  const temporary = path.join(inventory, `.${pid}-${randomUUID()}.tmp`)
  try {
    // Parent spawn and child preload may publish the same identity together.
    // Never truncate the visible PID entry: readers see only complete values.
    fs.writeFileSync(temporary, ticks, { flag: 'wx' })
    fs.renameSync(temporary, path.join(inventory, String(pid)))
  } finally {
    try {
      fs.unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
// Register before any fixture code can fork or daemonize. Also register at the
// parent spawn boundary, before the child can be cancelled during Node startup.
register(process.pid)
const spawn = childProcess.spawn
childProcess.spawn = function spawnRegisteredFixture(...args) {
  const child = spawn.apply(this, args)
  if (child.pid) register(child.pid)
  return child
}
fs.readdirSync = function fixtureProcessDirectory(directory, options) {
  const entries = readdir(directory, options)
  if (directory !== '/proc') return entries
  const registered = new Set(
    readdir(inventory).filter((name) => /^\d+$/.test(name))
  )
  return entries.filter((entry) => {
    const pid = typeof entry === 'string' ? entry : entry.name
    if (!registered.has(pid)) return false
    let currentTicks
    try {
      currentTicks = ticksFor(pid)
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes(error.code)) return false
      throw error
    }
    // A missing/corrupt entry for a live registered PID is an error, not proof
    // that the process is unrelated. Only valid unequal ticks prove PID reuse.
    const registeredTicks = readFile(path.join(inventory, pid), 'utf8')
    if (!validTicks(registeredTicks)) throw invalidIdentity(pid)
    return currentTicks === registeredTicks
  })
}
