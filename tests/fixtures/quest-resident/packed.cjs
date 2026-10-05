const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const names = ['sails-hook-quest', 'sails-hook-slipway']
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const json = (filename) => JSON.parse(fs.readFileSync(filename, 'utf8'))
const comparePath = (left, right) => (left < right ? -1 : left > right ? 1 : 0)
const repository = path.resolve(__dirname, '../../..')
const PACK_NPM_VERSION = '11.9.0'

function npmTool(env = process.env) {
  const requested = env.SLIPWAY_QUEST_NPM_CLI
  assert.ok(
    requested && path.isAbsolute(requested),
    'An explicit isolated npm CLI is required for packed lifecycle control'
  )
  assert.equal(path.basename(requested), 'npm-cli.js')
  const cli = fs.realpathSync(requested)
  const root = path.dirname(path.dirname(cli))
  const manifest = json(path.join(root, 'package.json'))
  assert.equal(manifest.name, 'npm')
  assert.equal(
    manifest.version,
    PACK_NPM_VERSION,
    'Use the pinned npm whose pacote honors ignoreScripts for prepare'
  )
  const pacote = path.join(root, 'node_modules/pacote')
  return {
    cli,
    provenance: {
      version: manifest.version,
      cliPath: cli,
      cliSha256: hash(fs.readFileSync(cli)),
      pacoteVersion: json(path.join(pacote, 'package.json')).version,
      prepareImplementationSha256: hash(
        fs.readFileSync(path.join(pacote, 'lib/dir.js'))
      )
    }
  }
}

function lifecyclePolicy(manifest) {
  const scripts = manifest.scripts || {}
  for (const name of [
    'prepack',
    'postpack',
    'build',
    'prebuild',
    'postbuild',
    'prepublish',
    'prepublishOnly',
    'preinstall',
    'install',
    'postinstall',
    'preprepare',
    'postprepare'
  ])
    assert.ok(
      !scripts[name],
      `${manifest.name} requires ${name}; ignoring scripts would not prove the published package`
    )
  if (scripts.prepare)
    assert.ok(
      manifest.name === 'sails-hook-quest' && scripts.prepare === 'husky',
      'Only the verified upstream husky-only prepare may be skipped'
    )
  return {
    ignoreScripts: true,
    prepare: scripts.prepare || null,
    noBuildOrPackOrInstallSteps: true
  }
}

function fileTree(root, includeDependencies = false) {
  assert.ok(
    fs.lstatSync(root).isDirectory() && !fs.lstatSync(root).isSymbolicLink(),
    'Installed hook must be a physical directory'
  )
  const files = []
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory).sort()) {
      if (!includeDependencies && entry === 'node_modules') continue
      const filename = path.join(directory, entry)
      const relative = prefix ? `${prefix}/${entry}` : entry
      const stat = fs.lstatSync(filename)
      assert.equal(
        stat.isSymbolicLink(),
        false,
        `Package source/dependency symlink is forbidden: ${relative}`
      )
      if (stat.isDirectory()) visit(filename, relative)
      else {
        assert.ok(
          stat.isFile(),
          `Unsupported installed package entry: ${relative}`
        )
        files.push({
          path: relative,
          bytes: stat.size,
          sha256: hash(fs.readFileSync(filename))
        })
      }
    }
  }
  visit(root)
  return files.sort((a, b) => comparePath(a.path, b.path))
}

async function archiveFiles(filename) {
  const extract = require('tar-stream').extract()
  const files = []
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      try {
        assert.ok(
          header.type === 'file' || header.type === 'directory',
          'npm pack must not contain symlinks or special files'
        )
        if (header.type === 'directory') {
          stream.resume()
          stream.on('end', next)
          return
        }
        assert.ok(header.name.startsWith('package/'))
        const relative = header.name.slice('package/'.length)
        assert.ok(
          relative &&
            !relative
              .split('/')
              .some((part) => !part || part === '.' || part === '..')
        )
        const digest = crypto.createHash('sha256')
        let bytes = 0
        stream.on('data', (chunk) => {
          bytes += chunk.length
          digest.update(chunk)
        })
        stream.on('end', () => {
          files.push({ path: relative, bytes, sha256: digest.digest('hex') })
          next()
        })
        stream.on('error', reject)
      } catch (error) {
        reject(error)
        stream.resume()
      }
    })
    extract.on('finish', resolve)
    extract.on('error', reject)
    const input = fs.createReadStream(filename)
    const gunzip = require('node:zlib').createGunzip()
    input.on('error', reject)
    gunzip.on('error', reject)
    input.pipe(gunzip).pipe(extract)
  })
  assert.equal(new Set(files.map((file) => file.path)).size, files.length)
  return files.sort((a, b) => comparePath(a.path, b.path))
}

function verifyInstalled(root, record) {
  const manifest = json(path.join(root, 'package.json'))
  assert.equal(manifest.name, record.name)
  if (record.version) assert.equal(manifest.version, record.version)
  assert.deepEqual(
    fileTree(root),
    record.files,
    `${record.name} installed files must exactly match the tarball manifest`
  )
  if (record.installedFiles)
    assert.deepEqual(
      fileTree(root, true),
      record.installedFiles,
      `${record.name} dependency tree changed after installation`
    )
}

function dependencyIdentities(root, files) {
  return files
    .filter((file) =>
      /(?:^|\/)node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file.path)
    )
    .map((file) => {
      const manifest = json(path.join(root, file.path))
      assert.ok(manifest.name && manifest.version)
      return {
        path: file.path,
        name: manifest.name,
        version: manifest.version,
        packageJsonSha256: file.sha256
      }
    })
}

function loadPacked(root, expected = {}) {
  assert.ok(
    root,
    'SLIPWAY_QUEST_PACKED_ROOT must name the prepared npm consumer; source links are not runtime proof'
  )
  root = fs.realpathSync(root)
  const provenance = json(path.join(root, 'provenance.json'))
  assert.equal(provenance.version, 1)
  assert.equal(provenance.mode, 'npm-packed-consumer')
  assert.equal(provenance.npm, PACK_NPM_VERSION)
  assert.equal(provenance.npmTool.version, PACK_NPM_VERSION)
  assert.equal(
    hash(fs.readFileSync(path.join(repository, 'package-lock.json'))),
    provenance.fixtureLockSha256
  )
  for (const key of ['questSha', 'slipwaySha']) {
    assert.match(
      expected[key] || '',
      /^[a-f0-9]{40}$/,
      `Verified ${key} is required`
    )
    assert.equal(provenance[key], expected[key])
  }
  for (const name of names) {
    const record = provenance.packages[name]
    assert.equal(record.name, name)
    assert.equal(path.basename(record.tarball), record.tarball)
    assert.equal(
      hash(fs.readFileSync(path.join(root, 'tarballs', record.tarball))),
      record.tarballSha256
    )
    assert.equal(hash(JSON.stringify(record.files)), record.filesSha256)
    assert.equal(
      hash(JSON.stringify(record.installedFiles)),
      record.installedFilesSha256
    )
    assert.deepEqual(
      lifecyclePolicy(
        json(path.join(root, 'consumer/node_modules', name, 'package.json'))
      ),
      record.lifecycle
    )
    verifyInstalled(path.join(root, 'consumer/node_modules', name), record)
    assert.deepEqual(
      dependencyIdentities(
        path.join(root, 'consumer/node_modules', name),
        record.installedFiles
      ),
      record.dependencies
    )
  }
  assert.equal(
    hash(fs.readFileSync(path.join(root, 'consumer/package-lock.json'))),
    provenance.consumerLockSha256
  )
  return {
    root,
    provenance,
    questRoot: path.join(root, 'consumer/node_modules/sails-hook-quest'),
    slipwayRoot: path.join(root, 'consumer/node_modules/sails-hook-slipway')
  }
}

function proofFor(packed) {
  const { provenance } = packed
  return {
    mode: provenance.mode,
    questSha: provenance.questSha,
    slipwaySha: provenance.slipwaySha,
    provenanceSha256: hash(
      fs.readFileSync(path.join(packed.root, 'provenance.json'))
    ),
    consumerLockSha256: provenance.consumerLockSha256,
    fixtureLockSha256: provenance.fixtureLockSha256,
    lockedFixtureDependencies: provenance.lockedFixtureDependencies,
    sourcePreflight: provenance.sourcePreflight,
    npmTool: provenance.npmTool,
    packages: Object.fromEntries(
      names.map((name) => {
        const record = provenance.packages[name]
        return [
          name,
          {
            version: record.version,
            tarball: record.tarball,
            tarballSha256: record.tarballSha256,
            filesSha256: record.filesSha256,
            installedFilesSha256: record.installedFilesSha256,
            packedFiles: record.files.length,
            installedFiles: record.installedFiles.length,
            installedBytes: record.installedBytes,
            copyBlockBytes: record.copyBlockBytes,
            dependencies: record.dependencies,
            lifecycle: record.lifecycle
          }
        ]
      })
    )
  }
}

async function git(args, cwd = repository) {
  return (
    await execute('git', args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 })
  ).stdout.trim()
}

async function packedSource(env, source) {
  const slipwaySha = await git(['rev-parse', 'HEAD'])
  assert.equal(
    slipwaySha,
    env.SLIPWAY_QUEST_CONSUMER_HEAD,
    'Packed consumer must belong to this exact Slipway checkout'
  )
  return loadPacked(env.SLIPWAY_QUEST_PACKED_ROOT, {
    questSha: source.sha,
    slipwaySha
  })
}

async function preparePacked(env = process.env) {
  assert.equal(env.CI, 'true', 'Package consumer preparation is CI-only')
  const tool = npmTool(env)
  const npm = (args, options) =>
    execute(process.execPath, [tool.cli, ...args], options)
  const { upstreamSource } = require('./docker.cjs')
  const source = await upstreamSource(env)
  const slipwaySha = await git(['rev-parse', 'HEAD'])
  assert.equal(slipwaySha, env.SLIPWAY_QUEST_CONSUMER_HEAD)
  assert.equal(
    await git([
      'status',
      '--porcelain',
      '--untracked-files=no',
      '--',
      'packages/hook'
    ]),
    '',
    'Pack only exact committed Slipway hook source'
  )
  const root = path.resolve(env.SLIPWAY_QUEST_PACKED_ROOT || '')
  assert.ok(
    root.startsWith(path.join(repository, '.tmp') + path.sep),
    'Use a disposable consumer under this checkout .tmp'
  )
  assert.equal(
    fs.existsSync(root),
    false,
    'Never reuse a prior packed consumer'
  )
  fs.mkdirSync(path.join(root, 'tarballs'), { recursive: true })
  fs.mkdirSync(path.join(root, 'consumer'))
  const packages = {}
  for (const [name, directory] of [
    [names[0], source.root],
    [names[1], path.join(repository, 'packages/hook')]
  ]) {
    const manifest = json(path.join(directory, 'package.json'))
    assert.equal(manifest.name, name)
    const lifecycle = lifecyclePolicy(manifest)
    assert.equal(fs.existsSync(path.join(directory, 'binding.gyp')), false)
    const packed = JSON.parse(
      (
        await npm(
          [
            'pack',
            '--ignore-scripts',
            '--json',
            '--workspaces=false',
            '--pack-destination',
            path.join(root, 'tarballs')
          ],
          { cwd: directory, timeout: 60000, maxBuffer: 2 * 1024 * 1024 }
        )
      ).stdout
    )
    assert.equal(packed.length, 1)
    assert.equal(packed[0].name, name)
    assert.equal(packed[0].version, manifest.version)
    const tarball = packed[0].filename
    assert.equal(path.basename(tarball), tarball)
    const archive = path.join(root, 'tarballs', tarball)
    const files = await archiveFiles(archive)
    assert.deepEqual(
      files.map((file) => file.path),
      packed[0].files.map((file) => file.path).sort(comparePath)
    )
    packages[name] = {
      name,
      version: manifest.version,
      tarball,
      tarballSha256: hash(fs.readFileSync(archive)),
      files,
      filesSha256: hash(JSON.stringify(files)),
      lifecycle
    }
  }
  fs.writeFileSync(
    path.join(root, 'consumer/package.json'),
    JSON.stringify({ private: true, scripts: {} })
  )
  await npm(
    [
      'install',
      '--prefix',
      path.join(root, 'consumer'),
      '--workspaces=false',
      '--ignore-scripts',
      '--omit=dev',
      '--legacy-peer-deps',
      '--install-strategy=nested',
      '--no-audit',
      '--no-fund',
      ...names.map((name) =>
        path.join(root, 'tarballs', packages[name].tarball)
      )
    ],
    { cwd: root, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }
  )
  for (const name of names) {
    const directory = path.join(root, 'consumer/node_modules', name)
    verifyInstalled(directory, packages[name])
    packages[name].installedFiles = fileTree(directory, true)
    packages[name].installedFilesSha256 = hash(
      JSON.stringify(packages[name].installedFiles)
    )
    packages[name].dependencies = dependencyIdentities(
      directory,
      packages[name].installedFiles
    )
    packages[name].installedBytes = packages[name].installedFiles.reduce(
      (sum, file) => sum + file.bytes,
      0
    )
    packages[name].copyBlockBytes = packages[name].installedFiles.reduce(
      (sum, file) => sum + Math.ceil(file.bytes / 4096) * 4096,
      0
    )
  }
  // Leave at least 4 MiB for fixture files, directories and dependency links.
  // Never silently enlarge the existing 16 MiB Docker /app tmpfs.
  assert.ok(
    names.reduce((sum, name) => sum + packages[name].copyBlockBytes, 0) <=
      12 * 1024 * 1024,
    'Measured installed hook copies exceed the existing worker app budget'
  )
  const provenance = {
    version: 1,
    mode: 'npm-packed-consumer',
    slipwaySha,
    questSha: source.sha,
    npm: tool.provenance.version,
    npmTool: tool.provenance,
    dependencyScope:
      'Exact hook tarballs with npm-installed nested production dependencies; existing lockfile Sails/machine/whelk links unchanged',
    sourcePreflight: { mode: 'source-only', runtimeEvidence: false },
    install: {
      ignoreScripts: true,
      omit: 'dev',
      legacyPeerDeps: true,
      strategy: 'nested'
    },
    consumerLockSha256: hash(
      fs.readFileSync(path.join(root, 'consumer/package-lock.json'))
    ),
    fixtureLockSha256: hash(
      fs.readFileSync(path.join(repository, 'package-lock.json'))
    ),
    lockedFixtureDependencies: Object.fromEntries(
      ['sails', 'machine', 'whelk'].map((name) => {
        const manifest = require(require.resolve(`${name}/package.json`, {
          paths: [repository]
        }))
        return [name, { name: manifest.name, version: manifest.version }]
      })
    ),
    packages
  }
  fs.writeFileSync(
    path.join(root, 'provenance.json'),
    JSON.stringify(provenance, null, 2) + '\n'
  )
  const packed = loadPacked(root, { slipwaySha, questSha: source.sha })
  const artifacts = path.join(
    repository,
    '.tmp/screenshots/quest-real-resident'
  )
  fs.mkdirSync(artifacts, { recursive: true })
  fs.copyFileSync(
    path.join(root, 'provenance.json'),
    path.join(artifacts, 'packed-consumer-provenance.json')
  )
  fs.copyFileSync(
    path.join(root, 'consumer/package-lock.json'),
    path.join(artifacts, 'packed-consumer-lock.json')
  )
  for (const name of names)
    fs.copyFileSync(
      path.join(root, 'tarballs', packages[name].tarball),
      path.join(artifacts, packages[name].tarball)
    )
  console.log('[Quest packed consumer]', JSON.stringify(proofFor(packed)))
}

module.exports = {
  PACK_NPM_VERSION,
  npmTool,
  lifecyclePolicy,
  fileTree,
  archiveFiles,
  verifyInstalled,
  dependencyIdentities,
  loadPacked,
  proofFor,
  packedSource,
  preparePacked
}
if (require.main === module)
  preparePacked().catch((error) => {
    console.error(error.stack)
    process.exitCode = 1
  })
