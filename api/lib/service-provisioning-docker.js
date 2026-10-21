const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const exec = promisify(execFile)
async function docker(args) {
  try {
    const { stdout } = await exec(
      sails.config.docker?.binaryPath || 'docker',
      args,
      { timeout: 10000, maxBuffer: 512 * 1024 }
    )
    return stdout
  } catch (error) {
    if (/no such (?:object|container|volume)/i.test(error.stderr || ''))
      return null
    // Docker errors can include command arguments and secrets.
    throw new Error('Docker could not verify the provisioning artifacts.')
  }
}
function create(run = docker) {
  async function reconcile(service) {
    const volume =
      service.imageMetadata?.volumeName ||
      Service.getDataVolumeName(service.containerName)
    const raw = await run([
      'inspect',
      '--type',
      'container',
      service.containerName
    ])
    const volumeRaw = await run(['volume', 'inspect', volume])
    if (!raw) {
      if (
        volumeRaw &&
        (!service.imageReference ||
          service.imageMetadata?.volumeName !== volume)
      )
        throw new Error(
          'An existing volume has no verified provisioning provenance. Preserve it for inspection.'
        )
      return null
    }
    const [container] = JSON.parse(raw)
    const env = Object.fromEntries(
      (container.Config?.Env || []).map((x) => {
        const i = x.indexOf('=')
        return [x.slice(0, i), x.slice(i + 1)]
      })
    )
    const credentials = {
      postgresql: {
        POSTGRES_USER: service.username,
        POSTGRES_PASSWORD: service.password,
        POSTGRES_DB: service.database
      },
      mysql: {
        MYSQL_ROOT_PASSWORD: service.password,
        MYSQL_USER: service.username,
        MYSQL_PASSWORD: service.password,
        MYSQL_DATABASE: service.database
      },
      mongodb: {
        MONGO_INITDB_ROOT_USERNAME: service.username,
        MONGO_INITDB_ROOT_PASSWORD: service.password,
        MONGO_INITDB_DATABASE: service.database
      }
    }[service.type]
    const dataDir = {
      postgresql: '/var/lib/postgresql',
      mysql: '/var/lib/mysql',
      mongodb: '/data/db',
      redis: '/data'
    }[service.type]
    const mount = container.Mounts?.find((m) => m.Destination === dataDir)
    const redisMatches =
      service.type !== 'redis' ||
      JSON.stringify(container.Config?.Cmd || []) ===
        JSON.stringify(
          service.password
            ? ['redis-server', '--requirepass', service.password]
            : ['redis-server']
        )
    if (
      !service.imageReference ||
      container.Config?.Image !== service.imageReference ||
      mount?.Type !== 'volume' ||
      mount.Name !== volume ||
      !volumeRaw ||
      !redisMatches ||
      !container.NetworkSettings?.Networks?.[
        global.sails?.config?.custom?.slipwayNetwork || 'slipway'
      ] ||
      (service.type === 'postgresql' &&
        (env.PGDATA !== '/var/lib/postgresql/data' ||
          env.POSTGRES_HOST_AUTH_METHOD === 'trust')) ||
      (credentials &&
        Object.entries(credentials).some(([k, v]) => env[k] !== v))
    )
      throw new Error(
        'Existing container identity, image, credentials or volume does not match. Preserve it for inspection.'
      )
    if (!container.State?.Running) {
      if (!['created', 'exited'].includes(container.State?.Status))
        throw new Error('The existing container is not in a recoverable state.')
      await run(['start', service.containerName])
    }
    return {
      containerId: container.Id,
      containerName: service.containerName,
      imageReference: service.imageReference,
      volumeName: volume
    }
  }
  async function verifyCredentials(
    service,
    { attempts = 10, intervalMs = 1000 } = {}
  ) {
    let command, expected
    switch (service.type) {
      case 'postgresql':
        command = [
          'exec',
          '-e',
          `PGPASSWORD=${service.password}`,
          service.containerName,
          'psql',
          '-h',
          '127.0.0.1',
          '-U',
          service.username,
          '-d',
          service.database,
          '-p',
          String(service.internalPort || 5432),
          '-X',
          '-w',
          '-tA',
          '-c',
          'SELECT 1'
        ]
        expected = '1'
        break
      case 'mysql':
        command = [
          'exec',
          '-e',
          `MYSQL_PWD=${service.password}`,
          service.containerName,
          'mysql',
          '--host=127.0.0.1',
          '--port',
          String(service.internalPort || 3306),
          '--user',
          service.username,
          '--database',
          service.database,
          '--batch',
          '--skip-column-names',
          '--execute',
          'SELECT 1'
        ]
        expected = '1'
        break
      case 'redis':
        command = [
          'exec',
          ...(service.password
            ? ['-e', `REDISCLI_AUTH=${service.password}`]
            : []),
          service.containerName,
          'redis-cli',
          '--no-auth-warning',
          '-p',
          String(service.internalPort || 6379),
          'ping'
        ]
        expected = 'PONG'
        break
      case 'mongodb':
        command = [
          'exec',
          '-e',
          `SLIPWAY_VERIFY_USER=${service.username}`,
          '-e',
          `SLIPWAY_VERIFY_PASSWORD=${service.password}`,
          service.containerName,
          'mongosh',
          '--quiet',
          '--port',
          String(service.internalPort || 27017),
          '--eval',
          'const a=db.getSiblingDB("admin"); const auth=await a.auth(process.env.SLIPWAY_VERIFY_USER, process.env.SLIPWAY_VERIFY_PASSWORD); if (!(auth===1 || auth?.ok===1)) quit(1); print((await a.runCommand({ping:1})).ok)'
        ]
        expected = '1'
        break
      default:
        throw new Error('Unsupported provisioning credential check.')
    }
    // Official images can briefly accept local readiness probes while their
    // initialization server is still creating the final user/database. Verify
    // authentication with a bounded wait instead of publishing a false failure.
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const output = await run(command)
        if (output?.trim() === expected) return
        if (output === null) break
      } catch {
        /* Never retain or return command errors containing credentials. */
      }
      if (attempt + 1 < attempts)
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error(
      'The stored database credentials could not be verified. Existing artifacts were preserved.'
    )
  }

  return { reconcile, verifyCredentials }
}
module.exports = { ...create(), _private: { create } }
