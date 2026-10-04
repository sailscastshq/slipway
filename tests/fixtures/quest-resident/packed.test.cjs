const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { pipeline } = require('node:stream/promises')
const {
  lifecyclePolicy,
  fileTree,
  archiveFiles,
  verifyInstalled,
  dependencyIdentities,
  loadPacked
} = require('./packed.cjs')
const { prepareDependencies } = require('./dependencies.cjs')

test('script suppression allows only the verified husky prepare and no build/pack/install steps', () => {
  assert.deepEqual(
    lifecyclePolicy({
      name: 'sails-hook-quest',
      scripts: { prepare: 'husky', test: 'sounding test' }
    }),
    {
      ignoreScripts: true,
      prepare: 'husky',
      noBuildOrPackOrInstallSteps: true
    }
  )
  assert.equal(lifecyclePolicy({ name: 'sails-hook-slipway' }).prepare, null)
  for (const name of [
    'build',
    'prepack',
    'postpack',
    'prepublishOnly',
    'install',
    'postinstall',
    'preprepare',
    'postprepare'
  ])
    assert.throws(
      () =>
        lifecyclePolicy({
          name: 'sails-hook-quest',
          scripts: { [name]: 'required-build' }
        }),
      /requires/
    )
  assert.throws(
    () =>
      lifecyclePolicy({
        name: 'sails-hook-quest',
        scripts: { prepare: 'husky && build' }
      }),
    /husky-only/
  )
  assert.throws(
    () =>
      lifecyclePolicy({
        name: 'sails-hook-slipway',
        scripts: { prepare: 'husky' }
      }),
    /husky-only/
  )
})

test('runtime consumer rejects missing provenance before source can substitute', () => {
  assert.throws(
    () => loadPacked(undefined),
    /source links are not runtime proof/
  )
})

test('tarball manifest hashes raw packed bytes and detects installed changes, extras and source symlinks', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-pack-pure-'))
  try {
    const installed = path.join(root, 'installed')
    fs.mkdirSync(installed)
    const contents = {
      'package.json': JSON.stringify({
        name: 'sails-hook-quest',
        version: '0.0.5'
      }),
      'index.js': 'module.exports = () => ({})\n'
    }
    const pack = require('tar-stream').pack()
    for (const [name, value] of Object.entries(contents)) {
      pack.entry({ name: `package/${name}` }, value)
      fs.writeFileSync(path.join(installed, name), value)
    }
    pack.finalize()
    const archive = path.join(root, 'fixture.tgz')
    await pipeline(
      pack,
      require('node:zlib').createGzip(),
      fs.createWriteStream(archive)
    )
    const files = await archiveFiles(archive)
    const record = { name: 'sails-hook-quest', files }
    assert.deepEqual(fileTree(installed), files)
    assert.doesNotThrow(() => verifyInstalled(installed, record))
    fs.writeFileSync(path.join(installed, 'index.js'), 'changed bytes')
    assert.throws(() => verifyInstalled(installed, record), /exactly match/)
    fs.writeFileSync(path.join(installed, 'index.js'), contents['index.js'])
    fs.writeFileSync(path.join(installed, 'extra.js'), 'unexpected')
    assert.throws(() => verifyInstalled(installed, record), /exactly match/)
    fs.rmSync(path.join(installed, 'extra.js'))
    const linked = path.join(root, 'linked-source')
    fs.symlinkSync(installed, linked)
    assert.throws(() => verifyInstalled(linked, record), /physical directory/)
    fs.rmSync(path.join(installed, 'index.js'))
    fs.symlinkSync(
      path.join(installed, 'package.json'),
      path.join(installed, 'index.js')
    )
    assert.throws(
      () => verifyInstalled(installed, record),
      /symlink is forbidden/
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runtime assembly copies both installed packages physically, preserves nested versions and keeps locked dependency links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-consumer-pure-'))
  try {
    const appRoot = path.join(root, 'app'),
      dependencies = path.join(root, 'locked')
    fs.mkdirSync(appRoot)
    fs.mkdirSync(dependencies)
    fs.mkdirSync(path.join(dependencies, 'sails'))
    const packages = {},
      locations = {}
    for (const name of ['sails-hook-quest', 'sails-hook-slipway']) {
      const location = path.join(root, name)
      fs.mkdirSync(location)
      fs.writeFileSync(
        path.join(location, 'package.json'),
        JSON.stringify({ name, version: 'test' })
      )
      fs.writeFileSync(
        path.join(location, 'index.js'),
        '// Synthetic package bytes, never executed\n'
      )
      const files = fileTree(location)
      fs.mkdirSync(path.join(location, 'node_modules/private-dependency'), {
        recursive: true
      })
      fs.writeFileSync(
        path.join(location, 'node_modules/private-dependency/package.json'),
        JSON.stringify({ name: 'private-dependency', version: '1.2.3' })
      )
      packages[name] = { name, files, installedFiles: fileTree(location, true) }
      locations[name] = location
    }
    prepareDependencies({
      appRoot,
      dependencies,
      questRoot: locations['sails-hook-quest'],
      slipwayRoot: locations['sails-hook-slipway'],
      packed: { provenance: { packages } }
    })
    assert.equal(
      fs.readlinkSync(path.join(appRoot, 'node_modules/sails')),
      path.join(dependencies, 'sails')
    )
    for (const name of Object.keys(packages)) {
      const destination = path.join(appRoot, 'node_modules', name)
      assert.equal(fs.lstatSync(destination).isSymbolicLink(), false)
      verifyInstalled(destination, packages[name])
      assert.equal(
        dependencyIdentities(destination, packages[name].installedFiles)[0]
          .version,
        '1.2.3'
      )
      assert.notEqual(
        fs.statSync(path.join(destination, 'index.js')).ino,
        fs.statSync(path.join(locations[name], 'index.js')).ino
      )
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
