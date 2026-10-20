// Run inside the existing container. This repairs only the legacy updater;
// it does not replace the container or open any database.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { randomUUID } = require('node:crypto')

const root = process.argv[2] || '/app'
const version = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'))
).version
if (!['0.0.87', '0.0.88', '0.0.89'].includes(version))
  throw new Error(`Unsupported bootstrap version ${version}; no files changed.`)
const file = path.join(root, 'api/helpers/system/apply-update.js')
const source = fs.readFileSync(file, 'utf8')
const line = "tempArgs.push('-p', formatPortBinding(portHost, tempPort, 1337))"
const replacement =
  '// Bootstrap: validation uses container-local health, without host publication.'
const plans = []
function plan(file, source, edits) {
  let patched = source
  for (const [before, after] of edits) {
    if (patched.includes(after)) continue
    if (patched.split(before).length !== 2)
      throw new Error('Unrecognized updater source; no files changed.')
    patched = patched.replace(before, after)
  }
  new vm.Script(patched, { filename: file })
  if (patched !== source) plans.push({ file, source, patched })
}
if (
  !source.includes('sails.helpers.docker.healthCheckContainer.with({') ||
  (version !== '0.0.87' && !source.includes("'http://localhost:1337/health'"))
)
  throw new Error('Unrecognized updater source; no files changed.')
plan(file, source, [
  [line, replacement],
  ...(version === '0.0.87' ? [['timeout: 60000,', 'timeout: 360000,']] : [])
])
if (version === '0.0.87') {
  const health = fs.readFileSync(
    path.join(root, 'api/helpers/docker/health-check-container.js'),
    'utf8'
  )
  if (
    !health.includes("'exec',") ||
    !health.includes('http://localhost:${port}${healthPath}')
  )
    throw new Error(
      'Unrecognized container-local health probe; no files changed.'
    )
  const swapFile = path.join(
    root,
    'api/helpers/system/build-update-swap-script.js'
  )
  plan(swapFile, fs.readFileSync(swapFile, 'utf8'), [
    ['attempt < 30;', 'attempt < 180;']
  ])
}
function replaceFile(file, contents) {
  const stat = fs.statSync(file)
  const temporary = `${file}.bootstrap-${randomUUID()}`
  try {
    const descriptor = fs.openSync(temporary, 'wx', stat.mode & 0o777)
    try {
      fs.writeFileSync(descriptor, contents)
      fs.fchownSync(descriptor, stat.uid, stat.gid)
      fs.fsyncSync(descriptor)
    } finally {
      fs.closeSync(descriptor)
    }
    fs.renameSync(temporary, file)
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
  }
}
// Sails discovers any non-md/txt extension in api/helpers. Backups must be
// outside that tree, including those written by the earlier bootstrap.
const backupDirectory = path.join(root, '.slipway-updater-backups')
const legacyBackups = fs
  .readdirSync(path.dirname(file))
  .filter((name) =>
    /^(apply-update|build-update-swap-script)\.js\.before-port-bootstrap-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      name
    )
  )
for (const name of legacyBackups) {
  if (!fs.lstatSync(path.join(path.dirname(file), name)).isFile())
    throw new Error('Unexpected bootstrap backup type; no files changed.')
}
if (plans.length || legacyBackups.length)
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 })
// Validate every helper before saving backups or changing either file.
for (const entry of plans) {
  entry.backup = path.join(
    backupDirectory,
    `${path.basename(entry.file)}.before-port-bootstrap-${randomUUID()}`
  )
  fs.writeFileSync(entry.backup, entry.source, { flag: 'wx', mode: 0o600 })
}
const applied = []
try {
  for (const entry of plans) {
    replaceFile(entry.file, entry.patched)
    applied.push(entry)
  }
} catch (error) {
  for (const entry of applied.reverse()) replaceFile(entry.file, entry.source)
  throw error
}
// Preserve previous originals without allowing them to shadow active helpers.
for (const name of legacyBackups) {
  const target = path.join(backupDirectory, `${name}-${randomUUID()}`)
  fs.renameSync(path.join(path.dirname(file), name), target)
}
console.log(
  JSON.stringify({
    version,
    status:
      plans.length || legacyBackups.length ? 'patched' : 'already patched',
    backups: plans.map(({ backup }) => backup),
    relocatedLegacyBackups: legacyBackups.length
  })
)
console.log(
  'Restart only the Slipway management container, then retry the normal update.'
)
