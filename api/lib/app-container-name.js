const { createHash } = require('node:crypto')

const MAX_DNS_LABEL_LENGTH = 63

function parts(projectSlug, environmentSlug, appSlug, deploymentId) {
  return [
    'slipway',
    projectSlug,
    environmentSlug,
    ...(!appSlug || appSlug === 'app' ? [] : [appSlug]),
    ...(deploymentId === undefined ? [] : [String(deploymentId)])
  ]
}

function legacyName(...args) {
  return parts(...args).join('-')
}

function generateName(projectSlug, environmentSlug, appSlug, deploymentId) {
  const identity = parts(projectSlug, environmentSlug, appSlug, deploymentId)
  const original = identity.join('-')
  if (original.length <= MAX_DNS_LABEL_LENGTH) return original

  // Hash the complete, separated identity, not just the visible prefix. This
  // keeps apps and deployments distinct even when their readable parts overlap.
  const hash = createHash('sha256')
    .update(JSON.stringify(identity))
    .digest('hex')
    .slice(0, 16)
  // Numeric deployment IDs fit in 16 characters. Retain the end for diagnostics
  // while bounding the suffix defensively if another ID format is ever used.
  const deploymentSuffix =
    deploymentId === undefined ? '' : `-${String(deploymentId).slice(-16)}`
  const suffix = `-${hash}${deploymentSuffix}`
  const prefix = original
    .slice(0, MAX_DNS_LABEL_LENGTH - suffix.length)
    .replace(/-+$/, '')
  return `${prefix}${suffix}`
}

module.exports = { generateName, legacyName }
