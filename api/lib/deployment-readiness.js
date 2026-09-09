const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const acorn = require('acorn')
const unknown = Symbol('unknown')

// Inspect source as data. Never require or evaluate application configuration.
async function inspectSource(root, key) {
  const files = new Map()
  const hash = crypto.createHmac('sha256', key)
  let entries = 0,
    bytes = 0
  const ignored = new Set(['node_modules', '.git', '.tmp', '.cache', 'output'])
  async function walk(directory, prefix = '') {
    for (const entry of (
      await fs.readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue
      if (++entries > 20000) throw new Error('Inspection limit')
      const name = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error('Unverified source link')
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), name + '/')
        continue
      }
      if (!entry.isFile()) throw new Error('Unverified source entry')
      const filename = path.join(directory, entry.name)
      const stat = await fs.stat(filename)
      bytes += stat.size
      if (bytes > 128 * 1024 * 1024) throw new Error('Inspection limit')
      const content = await fs.readFile(filename)
      hash.update(name).update('\0').update(content).update('\0')
      if (content.length <= 1024 * 1024) files.set(name, content.toString())
    }
  }
  try {
    await walk(root)
    return { files, revision: hash.digest('hex'), verified: true }
  } catch {
    return { files, revision: null, verified: false }
  }
}
function property(node, name) {
  return (
    node?.type === 'MemberExpression' &&
    !node.computed &&
    node.property.name === name
  )
}
function value(node, env) {
  if (!node) return unknown
  if (node.type === 'Literal') return node.value
  if (node.type === 'ObjectExpression') {
    const object = {}
    for (const item of node.properties) {
      if (item.type !== 'Property' || item.computed || item.kind !== 'init')
        continue
      const key = item.key.name || item.key.value
      if (['__proto__', 'constructor', 'prototype'].includes(key)) continue
      object[key] = value(item.value, env)
    }
    return object
  }
  if (node.type === 'LogicalExpression') {
    const left = value(node.left, env)
    if (left === unknown) return unknown
    if (node.operator === '||') return left || value(node.right, env)
    if (node.operator === '??') return left ?? value(node.right, env)
    if (node.operator === '&&') return left && value(node.right, env)
  }
  if (
    node.type === 'MemberExpression' &&
    property(node.object, 'env') &&
    node.object.object?.name === 'process'
  ) {
    const key = node.computed ? node.property.value : node.property.name
    return Object.hasOwn(env, key) ? env[key] : undefined
  }
  return unknown
}
function config(files, name, env) {
  let result = {}
  for (const filename of [`config/${name}.js`, 'config/env/production.js']) {
    try {
      const ast = acorn.parse(files.get(filename) || '', {
        ecmaVersion: 'latest'
      })
      for (const statement of ast.body) {
        const assignment = statement.expression
        if (
          assignment?.type !== 'AssignmentExpression' ||
          assignment.operator !== '='
        )
          continue
        const left = assignment.left
        let resolved
        if (
          property(left, name) &&
          property(left.object, 'exports') &&
          left.object.object?.name === 'module'
        )
          resolved = value(assignment.right, env)
        else if (property(left, 'exports') && left.object?.name === 'module')
          resolved = value(assignment.right, env)?.[name]
        if (resolved && resolved !== unknown && typeof resolved === 'object')
          result = { ...result, ...resolved }
      }
    } catch {
      result.unverified = true
    }
  }
  return result
}
function connection(raw, protocols) {
  if (!raw) return false
  try {
    const url = new URL(String(raw))
    return protocols.includes(url.protocol) && Boolean(url.hostname)
  } catch {
    return false
  }
}
function report({
  source,
  env,
  services = [],
  dockerfile = 'Dockerfile',
  healthPath = '/health',
  production,
  fingerprint,
  lastProbe
}) {
  const items = []
  const add = (
    id,
    category,
    status,
    title,
    evidence,
    fix,
    redeployRequired = true
  ) =>
    items.push({ id, category, status, title, evidence, fix, redeployRequired })
  let pkg
  try {
    pkg = JSON.parse(source.files.get('package.json'))
    if (!pkg || typeof pkg !== 'object') pkg = null
  } catch {}
  const deps = { ...pkg?.devDependencies, ...pkg?.dependencies }
  const runtimeEnv = { ...env, PORT: '1337', NODE_ENV: 'production' }
  const session = config(source.files, 'session', runtimeEnv)
  const sockets = config(source.files, 'sockets', runtimeEnv)
  const hooks = config(source.files, 'hooks', runtimeEnv)
  const datastores = config(source.files, 'datastores', runtimeEnv)
  const sessionDisabled = hooks.session === false
  add(
    'source',
    'build',
    source.verified ? 'pass' : 'warning',
    'Inspected source',
    source.verified
      ? 'The available source has a recorded fingerprint.'
      : 'Source is unavailable or could not be inspected completely.',
    'Push source with slipway push, or sync the connected repository. Inspection is repeated against the deployment snapshot.'
  )
  const docker = source.files.get(dockerfile)
  add(
    'dockerfile',
    'build',
    docker ? 'pass' : source.verified ? 'blocker' : 'warning',
    'Docker build',
    docker
      ? 'The configured Dockerfile is present.'
      : 'The configured Dockerfile was not found in inspected source.',
    'Add the Dockerfile at the path configured in App settings.'
  )
  const nodeMajor = docker
    ?.split('\n')
    .filter((line) => /^FROM\s/i.test(line))
    .at(-1)
    ?.match(/^FROM\s+(?:--platform=\S+\s+)?node:(\d+)(?:[.\s-]|$)/im)?.[1]
  add(
    'node',
    'runtime',
    nodeMajor && (Number(nodeMajor) < 22 || ['23', '25'].includes(nodeMajor))
      ? 'blocker'
      : ['22', '24'].includes(nodeMajor)
      ? 'pass'
      : 'warning',
    'Node runtime',
    nodeMajor
      ? `Dockerfile declares Node ${nodeMajor}.`
      : 'The runtime Node version could not be proven from the Dockerfile.',
    'Use a supported LTS Node runtime, such as Node 22 or 24, in the final application image.'
  )
  const sailsVersion = typeof deps.sails === 'string' ? deps.sails : ''
  add(
    'sails',
    'runtime',
    /^\s*[~^]?1\./.test(sailsVersion) ? 'pass' : 'warning',
    'Sails application',
    /^\s*[~^]?1\./.test(sailsVersion)
      ? 'Sails 1.x is declared.'
      : 'A supported Sails version could not be proven.',
    'Declare Sails in package.json and verify the resolved production version.'
  )
  add(
    'start',
    'build',
    typeof pkg?.scripts?.start === 'string' ? 'pass' : 'warning',
    'Application startup',
    pkg?.scripts?.start
      ? 'A start script is declared; the Dockerfile remains authoritative.'
      : 'No start script was detected.',
    'Provide a production start script or an explicit Dockerfile command.'
  )
  add(
    'port',
    'runtime',
    'warning',
    'HTTP listener',
    'Slipway sets PORT=1337 and probes the application on container port 1337.',
    'Honor process.env.PORT and bind to 0.0.0.0. The deployment HTTP probe verifies the listener.'
  )
  const secretPresent = Boolean(
    env.SESSION_SECRET ||
      (typeof session.secret === 'string' && session.secret.length >= 32)
  )
  add(
    'session-secret',
    'security',
    sessionDisabled || !production
      ? 'not-applicable'
      : secretPresent
      ? 'pass'
      : 'warning',
    'Production session secret',
    sessionDisabled
      ? 'The inspected configuration disables sessions.'
      : secretPresent
      ? 'A session secret is configured; its value is never returned.'
      : 'A production session secret could not be verified.',
    'Set a random SESSION_SECRET and reference it in production session configuration.'
  )
  const adapter = datastores.default?.adapter
  const dbPackage = ['sails-postgresql', 'sails-mysql', 'sails-mongo'].find(
    (name) => deps[name]
  )
  const dbProtocols = [
    'postgres:',
    'postgresql:',
    'mysql:',
    'mongodb:',
    'mongodb+srv:'
  ]
  const dbUrl =
    datastores.default?.url !== unknown
      ? datastores.default?.url || env.DATABASE_URL
      : env.DATABASE_URL
  const adapterProtocols = {
    'sails-postgresql': ['postgres:', 'postgresql:'],
    'sails-mysql': ['mysql:'],
    'sails-mongo': ['mongodb:', 'mongodb+srv:']
  }
  const externalDatabase = connection(
    dbUrl,
    adapterProtocols[adapter] || adapterProtocols[dbPackage] || dbProtocols
  )
  const verifiedExternalDatabase = services.some(
    (service) =>
      service.managementMode === 'external' &&
      service.status === 'reachable' &&
      service.envVarKey === 'DATABASE_URL' &&
      service.runtimeConnectionVerified
  )
  const managedDatabase = services.some(
    (service) =>
      ['postgresql', 'mysql', 'mongodb'].includes(service.type) &&
      service.status === 'running'
  )
  const needsDb = Boolean(
    dbPackage ||
      (typeof adapter === 'string' &&
        !['sails-disk', 'sails-sqlite'].includes(adapter)) ||
      env.DATABASE_URL
  )
  add(
    'datastore',
    'datastore',
    !needsDb
      ? 'not-applicable'
      : (dbUrl ? externalDatabase : managedDatabase)
      ? 'pass'
      : 'warning',
    'Datastore connection',
    verifiedExternalDatabase
      ? 'The registered external database passed its last connection and read-permission check. The app still verifies its own connection at startup.'
      : externalDatabase
      ? 'A database connection URL is configured. Reachability is checked when the app starts.'
      : managedDatabase
      ? 'A managed database is running. Verify the app connection configuration.'
      : needsDb
      ? 'A database adapter is declared, but its connection could not be verified.'
      : 'No external datastore requirement was detected.',
    'Configure a valid managed or external datastore URL. A managed service is optional.'
  )
  const redisConfigured =
    session.adapter === '@sailshq/connect-redis' ||
    session.adapter === 'connect-redis' ||
    sockets.adapter === '@sailshq/socket.io-redis'
  const redisUrl =
    connection(session.url, ['redis:', 'rediss:']) ||
    connection(sockets.url, ['redis:', 'rediss:']) ||
    connection(env.REDIS_URL, ['redis:', 'rediss:'])
  const redisManaged = services.some(
    (service) => service.type === 'redis' && service.status === 'running'
  )
  add(
    'sessions',
    'sessions',
    !production || (sessionDisabled && !redisConfigured)
      ? 'not-applicable'
      : redisConfigured
      ? redisUrl || redisManaged
        ? 'pass'
        : 'warning'
      : 'warning',
    'Session and socket storage',
    redisConfigured
      ? redisUrl
        ? 'The production adapter has a configured Redis URL; managed Redis is optional.'
        : redisManaged
        ? 'The production adapter has a running managed Redis service.'
        : 'The production configuration selects Redis, but a connection could not be verified.'
      : session.adapter && session.adapter !== unknown
      ? 'A custom session adapter is configured. Its durability needs application-level verification.'
      : 'Persistent session storage could not be verified from the production configuration.',
    redisConfigured
      ? 'Provide a reachable REDIS_URL or the adapter’s configured connection. Verify it during app startup.'
      : 'If this app needs sessions to survive restarts or scale across workers, configure a durable session store appropriate to the app. Redis is optional.'
  )
  const hookVersion =
    typeof deps['sails-hook-slipway'] === 'string' &&
    /^[0-9~^<>=.*| \-v]{1,80}$/.test(deps['sails-hook-slipway'])
      ? deps['sails-hook-slipway']
      : 'custom version'
  add(
    'slipway-hook',
    'slipway-capability',
    deps['sails-hook-slipway'] ? 'pass' : 'not-applicable',
    'Bridge and Lookout',
    deps['sails-hook-slipway']
      ? `sails-hook-slipway ${hookVersion} is declared; Bridge and Lookout are available when configured.`
      : 'sails-hook-slipway is not declared. It is optional for deployment.',
    'Install and configure sails-hook-slipway to enable app-native Bridge and Lookout.'
  )
  for (const [id, names, title] of [
    ['quest', ['sails-hook-quest', 'sails-quest'], 'Quest jobs'],
    ['content', ['sails-hook-content', 'sails-content'], 'Content management'],
    ['uploads', ['sails-hook-uploads'], 'Uploads']
  ]) {
    if (names.some((name) => deps[name]))
      add(
        id,
        'slipway-capability',
        'pass',
        title,
        'The supporting package is declared.',
        'Configure this capability in the app; verify production storage and credentials.'
      )
  }
  const required = pkg?.slipway?.readiness?.requiredEnv
  if (required !== undefined) {
    const valid =
      Array.isArray(required) &&
      required.length <= 100 &&
      required.every(
        (name) =>
          typeof name === 'string' && /^[A-Z_][A-Z0-9_]{0,99}$/.test(name)
      )
    add(
      'required-env',
      'security',
      !valid || required.some((name) => !String(runtimeEnv[name] || '').trim())
        ? 'blocker'
        : 'pass',
      'Declared required variables',
      !valid
        ? 'The package.json readiness.requiredEnv declaration is invalid.'
        : required.filter((name) => !String(runtimeEnv[name] || '').trim())
            .length
        ? `Missing required variable names: ${required
            .filter((name) => !String(runtimeEnv[name] || '').trim())
            .join(', ')}.`
        : 'All explicitly required environment variables are configured.',
      'Set the declared variables in environment or app settings. Values are never shown here.'
    )
  }
  const version = fingerprint({
    source: source.revision,
    configuration: env,
    services: services.map(({ id, type, status, updatedAt }) => ({
      id,
      type,
      status,
      updatedAt
    })),
    dockerfile,
    healthPath,
    production
  })
  const currentProbe = lastProbe?.version === version
  add(
    'health',
    'health',
    currentProbe && lastProbe.success ? 'pass' : 'warning',
    'Deployment health probe',
    currentProbe
      ? `${healthPath}: the last deployment probe ${
          lastProbe.success ? 'passed' : 'failed'
        }.`
      : `${healthPath}: not verified for this source and configuration.`,
    'Serve a successful HTTP response at this path. Slipway probes the candidate before switching traffic.',
    true
  )
  return {
    version,
    sourceRevision: source.revision,
    inspectedAt: Date.now(),
    healthPath,
    lastProbe: lastProbe
      ? {
          success: lastProbe.success,
          checkedAt: lastProbe.checkedAt,
          stale: !currentProbe
        }
      : null,
    items,
    canDeploy: !items.some((item) => item.status === 'blocker'),
    summary: Object.fromEntries(
      ['pass', 'warning', 'blocker', 'not-applicable'].map((status) => [
        status,
        items.filter((item) => item.status === status).length
      ])
    )
  }
}
module.exports = { inspectSource, report }
