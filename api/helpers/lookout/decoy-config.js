const { createHash } = require('node:crypto')

const PATHS = ['/.env', '/.env.local', '/wp-config.php', '/config/database.yml']
const PREFIX = 'lookout.decoys.app:'
const OFF = { enabled: false, paths: [], revision: '' }

module.exports = {
  friendlyName: 'Decoy config',
  description:
    'Load app-scoped Lookout Decoys settings without changing app records.',
  inputs: { apps: { type: 'ref', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ apps }) {
    if (!apps.length) return []
    const settings = await Setting.find({ key: apps.map((app) => key(app.id)) })
    const configs = new Map(settings.map((s) => [s.key, parse(s.value)]))
    return apps.map((app) => ({
      ...app,
      lookoutDecoys: Object.hasOwn(app, 'lookoutDecoys')
        ? app.lookoutDecoys
        : configs.get(key(app.id)) || { ...OFF }
    }))
  }
}

function key(id) {
  return `${PREFIX}${id}`
}
function parse(value) {
  try {
    const config = JSON.parse(value)
    if (config.enabled !== true) return { ...OFF }
    if (
      !Array.isArray(config.paths) ||
      !config.paths.length ||
      config.paths.length > PATHS.length ||
      config.paths.some((p) => !PATHS.includes(p)) ||
      new Set(config.paths).size !== config.paths.length ||
      !/^[a-f0-9]{32}$/.test(config.revision)
    )
      return { ...OFF }
    return { enabled: true, paths: config.paths, revision: config.revision }
  } catch {
    return { ...OFF }
  }
}
function prefix(app) {
  return !app.routePath || app.routePath === '/'
    ? ''
    : `/${String(app.routePath).replace(/^\/+|\/+$/g, '')}`
}
function effectivePath(app, path) {
  return `${prefix(app)}${path}`
}
function validate(app, siblings) {
  const config = app.lookoutDecoys || OFF
  if (!config.enabled) return null
  if (app.routePath === null)
    return 'Workers cannot serve decoys. Choose an app route first.'
  if (parse(JSON.stringify(config)).enabled !== true)
    return 'Choose distinct paths from the decoy allowlist.'
  const mount = prefix(app)
  if (
    !/^(\/[a-zA-Z0-9._-]+)*$/.test(mount) ||
    /(?:^|\/)(?:_slipway|\.well-known|bridge|bearing|wake|health)(?:\/|$)/.test(
      mount
    )
  )
    return 'This reserved or ambiguous app mount cannot serve decoys.'
  for (const path of config.paths) {
    const target = effectivePath(app, path)
    if (path === app.healthPath || target === app.healthPath)
      return `${target} conflicts with this app’s health path.`
    for (const sibling of siblings) {
      if (String(sibling.id) === String(app.id) || sibling.routePath === null)
        continue
      const other = prefix(sibling)
      // Existing ingress uses prefix matching, including undeployed siblings.
      if (
        other === mount ||
        (other && target.startsWith(other) && other.length >= mount.length)
      )
        return `${target} conflicts with the ${
          sibling.name || sibling.slug
        } app mount.`
    }
  }
  return null
}
function token(app, path) {
  return `${app.id}|${app.lookoutDecoys.revision}|${effectivePath(app, path)}`
}
function logIdentity(environmentId) {
  const id = createHash('sha256')
    .update(String(environmentId))
    .digest('hex')
    .slice(0, 24)
  return { name: `decoys_${id}`, file: `/data/slipway-decoys-${id}.log` }
}
module.exports._private = {
  PATHS,
  OFF,
  PREFIX,
  key,
  parse,
  prefix,
  effectivePath,
  validate,
  token,
  logIdentity
}
