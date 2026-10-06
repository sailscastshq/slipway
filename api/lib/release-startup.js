const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const migrations = require('./release-migrations')

function overlaps(a, b) {
  const first = path.posix.normalize(a)
  const second = path.posix.normalize(b)
  return (
    first === second ||
    first.startsWith(`${second}/`) ||
    second.startsWith(`${first}/`)
  )
}

function dockerRole({ containers, hostname, directory }) {
  const matches = containers.filter(
    (container) =>
      container.Id?.startsWith(hostname) ||
      container.Config?.Hostname === hostname
  )
  if (matches.length !== 1)
    throw new Error(
      'Could not identify the Slipway update container; database migration did not start.'
    )
  const self = matches[0]
  const storage = (self.Mounts || []).filter(
    (mount) =>
      typeof mount.Destination === 'string' &&
      overlaps(mount.Destination, directory)
  )
  if (
    !storage.length ||
    storage.some(
      (mount) =>
        mount.RW === false ||
        !mount.Source ||
        !['bind', 'volume', undefined].includes(mount.Type)
    )
  )
    throw new Error(
      'Slipway database storage must be writable and persistent before applying release migrations.'
    )
  if (self.Name === '/slipway-next') return 'preflight'
  for (const container of containers) {
    if (container.Id === self.Id || !container.State?.Running) continue
    if (
      (container.Mounts || []).some(
        (mount) =>
          mount.RW !== false &&
          typeof mount.Source === 'string' &&
          mount.Source &&
          storage.some((owned) => overlaps(mount.Source, owned.Source))
      )
    )
      throw new Error(
        'Another running Docker container can write Slipway database storage; stop it before retrying the update.'
      )
  }
  return 'startup'
}

function inspectRole(directory) {
  // Local development keeps the existing Sails migration policy. Managed Docker
  // startup verifies writers using the same Docker socket already used by Bosun.
  if (!fs.existsSync('/.dockerenv')) return 'startup'
  const docker = (args) =>
    execFileSync('docker', args, {
      encoding: 'utf8',
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024
    })
  const ids = docker(['ps', '-q']).trim().split(/\s+/).filter(Boolean)
  if (!ids.length)
    throw new Error('Could not inspect the running Slipway container.')
  return dockerRole({
    containers: JSON.parse(docker(['inspect', ...ids])),
    hostname: os.hostname(),
    directory
  })
}

async function beforeLift({
  directory = path.resolve(__dirname, '../../db'),
  role = inspectRole(directory),
  listen = true
} = {}) {
  const result = await migrations.run({
    directory,
    preflightOnly: role === 'preflight'
  })
  if (role !== 'preflight') return true
  // Released 0.0.87 validates slipway-next on the live mounts before its Bosun
  // sidecar stops slipway. Serve only the preflight result: no ORM, hooks, users,
  // jobs or live DDL. The released updater removes this container before swapping.
  if (listen)
    require('node:http')
      .createServer((request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.statusCode = request.url === '/health' ? 200 : 503
        response.end(JSON.stringify(result))
      })
      .listen(Number(process.env.PORT) || 1337, '0.0.0.0')
  return false
}

module.exports = { beforeLift, dockerRole, overlaps }
