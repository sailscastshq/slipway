// Builder-only packaging: public source + minimal pinned installed dependencies.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const output = process.argv[2],
  sourceRevision = process.argv[3],
  builderImage = process.argv[4]
if (
  process.platform !== 'linux' ||
  !/^[a-f0-9]{40}$/.test(sourceRevision || '') ||
  !/^.+@sha256:[a-f0-9]{64}$/.test(builderImage || '') ||
  require('../package.json').version !==
    require('../api/lib/upgrade-registry').release
)
  throw new Error('Verified release builder required')
fs.mkdirSync(output, { recursive: true })
for (const name of [
  'api/lib',
  'api/helpers/dock',
  'scripts/upgrade-host-native.cjs',
  'package.json'
]) {
  fs.mkdirSync(path.dirname(path.join(output, name)), { recursive: true })
  fs.cpSync(name, path.join(output, name), {
    recursive: true,
    dereference: true
  })
}
fs.mkdirSync(path.join(output, 'bin'))
fs.copyFileSync(process.execPath, path.join(output, 'bin/node'))
fs.chmodSync(path.join(output, 'bin/node'), 0o755)
for (const name of [
  'better-sqlite3',
  'bindings',
  'file-uri-to-path',
  'semver'
]) {
  const root = path.dirname(require.resolve(name + '/package.json'))
  const dest = path.join(output, 'node_modules', name)
  fs.mkdirSync(dest, { recursive: true })
  if (name === 'better-sqlite3') {
    for (const item of [
      'package.json',
      'lib',
      'build/Release/better_sqlite3.node'
    ]) {
      fs.mkdirSync(path.dirname(path.join(dest, item)), { recursive: true })
      fs.cpSync(path.join(root, item), path.join(dest, item), {
        recursive: true
      })
    }
  } else fs.cpSync(root, dest, { recursive: true, dereference: true })
}
const files = []
function walk(relative = '') {
  for (const name of fs.readdirSync(path.join(output, relative)).sort()) {
    const item = path.join(relative, name),
      absolute = path.join(output, item),
      stat = fs.lstatSync(absolute)
    if (stat.isDirectory()) walk(item)
    else if (stat.isFile() && !(stat.mode & 0o022))
      files.push({
        path: item,
        bytes: stat.size,
        sha256: crypto
          .createHash('sha256')
          .update(fs.readFileSync(absolute))
          .digest('hex')
      })
    else throw new Error('Unconfirmed bundle file')
  }
}
walk()
fs.writeFileSync(
  path.join(output, 'host-manifest.json'),
  JSON.stringify({
    format: 1,
    version: require('../package.json').version,
    sourceRevision,
    builderImage,
    platform: process.platform,
    arch: process.arch,
    modules: process.versions.modules,
    nodeVersion: process.version,
    glibcMinimum: process.report.getReport().header.glibcVersionRuntime,
    files
  })
)
