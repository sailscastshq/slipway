const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')

const fixtureDependencies = {
  sails: '*',
  'sails-hook-orm': '*',
  'sails-hook-quest': '*',
  'sails-hook-slipway': '*'
}

function prepareDependencies({
  appRoot,
  dependencies,
  questRoot,
  slipwayRoot,
  packed
}) {
  const destination = path.join(appRoot, 'node_modules')
  fs.mkdirSync(destination)
  // Keep the root lockfile dependency identities. Runtime hooks themselves are
  // physical copies of installed tarballs; source links are offline-only.
  const overrides = {
    'sails-hook-quest': questRoot,
    'sails-hook-slipway': slipwayRoot
  }
  for (const entry of fs.readdirSync(dependencies)) {
    if (Object.hasOwn(overrides, entry)) continue
    fs.symlinkSync(
      path.join(dependencies, entry),
      path.join(destination, entry)
    )
  }
  for (const [name, source] of Object.entries(overrides)) {
    if (!packed) fs.symlinkSync(source, path.join(destination, name))
    else {
      const { verifyInstalled } = require('./packed.cjs')
      verifyInstalled(source, packed.provenance.packages[name])
      fs.cpSync(source, path.join(destination, name), { recursive: true })
      verifyInstalled(
        path.join(destination, name),
        packed.provenance.packages[name]
      )
    }
  }
}

function verifyDependencies({
  appRoot,
  dependencies,
  questRoot,
  slipwayRoot,
  packed
}) {
  const appRequire = createRequire(path.join(appRoot, 'package.json'))
  const resolved = {}
  for (const name of Object.keys(fixtureDependencies)) {
    const packagePath = appRequire.resolve(`${name}/package.json`)
    resolved[name] = appRequire.resolve(name)
    const packageRequire = createRequire(packagePath)
    const manifest = packageRequire('./package.json')
    for (const dependency of Object.keys({
      ...manifest.dependencies,
      ...manifest.peerDependencies
    }))
      packageRequire.resolve(dependency)
  }
  for (const [name, source] of [
    ['sails-hook-quest', questRoot],
    ['sails-hook-slipway', slipwayRoot]
  ]) {
    const expected = packed ? path.join(appRoot, 'node_modules', name) : source
    assert.equal(
      fs.realpathSync(appRequire.resolve(`${name}/package.json`)),
      fs.realpathSync(path.join(expected, 'package.json')),
      packed
        ? `Installed tarball must own ${name}`
        : `Offline source must own ${name}`
    )
    if (packed) {
      assert.equal(fs.lstatSync(expected).isSymbolicLink(), false)
      require('./packed.cjs').verifyInstalled(
        expected,
        packed.provenance.packages[name]
      )
    }
  }
  const installedRequire = createRequire(
    path.join(dependencies, '.fixture.cjs')
  )
  for (const name of ['sails', 'machine', 'whelk'])
    assert.equal(appRequire.resolve(name), installedRequire.resolve(name))
  assert.equal(
    fs.realpathSync(path.join(appRoot, 'node_modules/.bin/sails')),
    appRequire.resolve('sails/bin/sails.js'),
    'Normal sails run executable must resolve through installed dependencies'
  )
  return resolved
}

module.exports = {
  fixtureDependencies,
  prepareDependencies,
  verifyDependencies
}
