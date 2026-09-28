const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const fingerprintHelmDatastores = require('./helm-config-fingerprint')
const collectSailsCompletionMetadata = require('./helm-completion-metadata')

const CONTRACT_DIR = '/tmp/slipway-helm-runtimes'

function environmentFingerprint(env) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        Object.keys(env)
          .sort()
          .map((key) => [key, String(env[key])])
      )
    )
    .digest('hex')
}

function readStartupEnvironment(filesystem, procRoot) {
  return Object.fromEntries(
    filesystem
      .readFileSync(`${procRoot}/self/environ`, 'utf8')
      .split('\0')
      .filter((entry) => entry.includes('='))
      .map((entry) => {
        const index = entry.indexOf('=')
        return [entry.slice(0, index), entry.slice(index + 1)]
      })
  )
}

function startTicks(stat) {
  const fields = stat
    .slice(stat.lastIndexOf(')') + 1)
    .trim()
    .split(/\s+/)
  return /^\d+$/.test(fields[19] || '') ? fields[19] : null
}

function registerHelmRuntime({
  appId,
  deploymentId,
  sailsApp,
  runtime = process,
  filesystem = fs,
  directory = CONTRACT_DIR,
  procRoot = '/proc'
}) {
  if (
    runtime.platform !== 'linux' ||
    runtime.env.SLIPWAY_HELM_EXECUTION_ID ||
    !/^\d+$/.test(String(appId || '')) ||
    !/^\d+$/.test(String(deploymentId || '')) ||
    (runtime.env.SLIPWAY_APP_ID || runtime.env.SLIPWAY_TELEMETRY_APP_ID) !==
      String(appId) ||
    (runtime.env.SLIPWAY_DEPLOYMENT_ID ||
      runtime.env.SLIPWAY_TELEMETRY_DEPLOYMENT_ID) !== String(deploymentId)
  )
    return null

  // `sails run` lifts its own Sails instance for one Quest job. It must never
  // claim to be the deployed app runtime.
  const script = path.basename(runtime.argv[1] || '')
  if (/^sails(?:\.js)?$/.test(script) && runtime.argv[2] === 'run') return null

  const ticks = startTicks(
    filesystem.readFileSync(`${procRoot}/self/stat`, 'utf8')
  )
  if (!ticks) return null
  const launchArguments = filesystem
    .readFileSync(`${procRoot}/self/cmdline`, 'utf8')
    .split('\0')
    .filter(Boolean)
  const appScript = runtime.argv[1]
  const argvStartIndex = launchArguments.findIndex(
    (argument, index) =>
      index > 0 &&
      appScript &&
      path.resolve(runtime.cwd(), argument) ===
        path.resolve(runtime.cwd(), appScript)
  )
  if (argvStartIndex < 1) return null
  filesystem.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const filename = `${appId}-${deploymentId}-${runtime.pid}.json`
  const destination = path.join(directory, filename)
  const temporary = path.join(directory, `.${filename}.${crypto.randomUUID()}`)
  let completionMetadata = null
  if (sailsApp) {
    try {
      const candidate = collectSailsCompletionMetadata(sailsApp)
      if (Buffer.byteLength(JSON.stringify(candidate)) <= 96 * 1024)
        completionMetadata = candidate
    } catch {
      // Autocomplete can still use the isolated Sails lift.
    }
  }
  const contract = {
    version: 1,
    appId: String(appId),
    deploymentId: String(deploymentId),
    pid: runtime.pid,
    startTicks: ticks,
    appPath: runtime.cwd(),
    executable: runtime.execPath,
    argvStartIndex,
    environmentSource: 'process-start',
    // Helm reads /proc/<pid>/environ, which represents the launch environment.
    // process.env can change while Sails loads and cannot be reconstructed by
    // the isolated runner. The datastore fingerprint guards effective config.
    environmentFingerprint: environmentFingerprint(
      readStartupEnvironment(filesystem, procRoot)
    ),
    datastoreFingerprint: sailsApp ? fingerprintHelmDatastores(sailsApp) : null,
    completionMetadata
  }
  try {
    filesystem.writeFileSync(temporary, JSON.stringify(contract), {
      mode: 0o600
    })
    filesystem.renameSync(temporary, destination)
  } finally {
    try {
      filesystem.unlinkSync(temporary)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return () => {
    try {
      filesystem.unlinkSync(destination)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}

module.exports = { registerHelmRuntime, environmentFingerprint, startTicks }
