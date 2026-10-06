// Explicit historical helper contract only. Model the compiled 87 metadata and
// its unannotated launch; current 88 admission remains covered by native tests.
module.exports = async function withLegacyRelease(work) {
  const pkg = require('../../package.json')
  const version = pkg.version
  const names = Object.keys(process.env).filter((name) =>
    name.startsWith('SLIPWAY_UPGRADE_')
  )
  const saved = Object.fromEntries(
    names.map((name) => [name, process.env[name]])
  )
  try {
    pkg.version = '0.0.87'
    for (const name of names) delete process.env[name]
    return await work()
  } finally {
    pkg.version = version
    Object.assign(process.env, saved)
  }
}
