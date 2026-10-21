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
  return { reconcile }
}
module.exports = { ...create(), _private: { create } }
