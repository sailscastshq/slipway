// Dashboard-owned CI protocol. Parity tests bind this to the independently packaged CLI executor.
const crypto = require('node:crypto')
function canonical(value, depth = 0) {
  if (depth > 16) throw new Error('CI evidence nesting exceeds its limit.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value))
    return JSON.stringify(value)
  if (Array.isArray(value))
    return '[' + value.map((item) => canonical(item, depth + 1)).join(',') + ']'
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map(
          (key) => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)
        )
        .join(',') +
      '}'
    )
  throw new Error('CI evidence must contain only JSON values.')
}
function digest(value) {
  return (
    'sha256:' +
    crypto
      .createHash('sha256')
      .update(typeof value === 'string' ? value : canonical(value))
      .digest('hex')
  )
}
function configuration(manifest, image, platform) {
  if (
    !/^node@sha256:[a-f0-9]{64}$/.test(image) ||
    !['linux/amd64', 'linux/arm64'].includes(platform)
  )
    throw new Error(
      'Select a pinned Linux Node image and explicit architecture.'
    )
  const scripts = ['lint', 'test', 'build'].map((name) => {
    const script = manifest.scripts?.[name]
    if (typeof script !== 'string' || !script.trim() || script.length > 8192)
      throw new Error(`A reviewed ${name} script is required.`)
    return { name, script }
  })
  return {
    version: 1,
    scripts,
    install: ['npm', 'ci'],
    runtime: image,
    platform,
    testProfile: 'sails-sqlite-no-egress-v3',
    executorDigest: executorDigest(),
    filesystem: {
      root: 'read-only',
      workspace: 'tmpfs-exec',
      temporary: 'tmpfs-noexec'
    },
    networkPolicy: 'install-egress-then-none',
    user: '1000:1000',
    cpus: 2,
    memoryBytes: 4294967296,
    workspaceBytes: 1610612736,
    timeoutSeconds: 1200
  }
}
function executorDigest() {
  return 'sha256:49a536be5593423e197a1f10db8054b5115cbe9b1359ae20183fccc0d8290ac2'
}

function statement(challenge, report) {
  return {
    version: 1,
    purpose: 'slipway-ci-source-checks',
    challenge,
    reportHash: digest(report)
  }
}
module.exports = { canonical, digest, configuration, executorDigest, statement }
