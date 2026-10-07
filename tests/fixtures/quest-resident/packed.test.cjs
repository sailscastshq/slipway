const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { test } = require('node:test')
const { pipeline } = require('node:stream/promises')
const {
  PACK_NPM_VERSION,
  npmTool,
  lifecyclePolicy,
  fileTree,
  archiveFiles,
  verifyInstalled,
  verifyRegistrySource,
  dependencyIdentities,
  loadPacked
} = require('./packed.cjs')
const { prepareDependencies } = require('./dependencies.cjs')

test('packing requires the isolated exact npm version with supported prepare suppression', () => {
  assert.throws(() => npmTool({}), /explicit isolated npm CLI/)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'quest-pack-tool-pure-'))
  try {
    fs.mkdirSync(path.join(root, 'bin'))
    fs.mkdirSync(path.join(root, 'node_modules/pacote/lib'), {
      recursive: true
    })
    const cli = path.join(root, 'bin/npm-cli.js')
    fs.writeFileSync(cli, '// synthetic CLI bytes; never executed\n')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'npm', version: '10.9.9' })
    )
    assert.throws(() => npmTool({ SLIPWAY_QUEST_NPM_CLI: cli }), /pinned npm/)
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'npm', version: PACK_NPM_VERSION })
    )
    fs.writeFileSync(
      path.join(root, 'node_modules/pacote/package.json'),
      JSON.stringify({ name: 'pacote', version: '21.1.0' })
    )
    fs.writeFileSync(
      path.join(root, 'node_modules/pacote/lib/dir.js'),
      '// synthetic implementation bytes; never executed\n'
    )
    const tool = npmTool({ SLIPWAY_QUEST_NPM_CLI: cli })
    assert.equal(tool.cli, fs.realpathSync(cli))
    assert.equal(tool.provenance.cliPath, fs.realpathSync(cli))
    assert.equal(tool.provenance.version, '11.9.0')
    assert.equal(tool.provenance.pacoteVersion, '21.1.0')
    assert.match(tool.provenance.cliSha256, /^[a-f0-9]{64}$/)
    assert.match(tool.provenance.prepareImplementationSha256, /^[a-f0-9]{64}$/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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
    const published = {
      tarball:
        'https://registry.npmjs.org/sails-hook-quest/-/sails-hook-quest-0.0.5.tgz',
      integrity: `sha512-${crypto
        .createHash('sha512')
        .update(fs.readFileSync(archive))
        .digest('base64')}`
    }
    const verifyPublished = (metadata = published) =>
      verifyRegistrySource(archive, files, installed, metadata, record.name)
    assert.doesNotThrow(() => verifyPublished())
    assert.throws(() =>
      verifyPublished({ ...published, integrity: 'sha512-forged' })
    )
    assert.throws(() =>
      verifyPublished({
        ...published,
        tarball: 'https://example.com/fixture.tgz'
      })
    )
    assert.deepEqual(fileTree(installed), files)
    assert.doesNotThrow(() => verifyInstalled(installed, record))
    fs.writeFileSync(path.join(installed, 'index.js'), 'changed bytes')
    assert.throws(() => verifyPublished(), /differs from verified source/)
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
