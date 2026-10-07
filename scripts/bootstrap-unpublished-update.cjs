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
if (!['0.0.88', '0.0.89'].includes(version))
  throw new Error(`Unsupported bootstrap version ${version}; no files changed.`)
const file = path.join(root, 'api/helpers/system/apply-update.js')
const source = fs.readFileSync(file, 'utf8')
const line = "tempArgs.push('-p', formatPortBinding(portHost, tempPort, 1337))"
const replacement =
  '// Bootstrap: validation uses container-local health, without host publication.'
if (source.includes(replacement)) {
  console.log(JSON.stringify({ version, status: 'already patched' }))
  process.exit(0)
}
if (
  source.split(line).length !== 2 ||
  !source.includes('sails.helpers.docker.healthCheckContainer.with({') ||
  !source.includes("'http://localhost:1337/health'")
)
  throw new Error('Unrecognized updater source; no files changed.')
const patched = source.replace(line, replacement)
new vm.Script(patched, { filename: file })
const stat = fs.statSync(file)
const backup = `${file}.before-port-bootstrap-${randomUUID()}`
fs.writeFileSync(backup, source, { flag: 'wx', mode: 0o600 })
const temporary = `${file}.bootstrap-${randomUUID()}`
try {
  const descriptor = fs.openSync(temporary, 'wx', stat.mode & 0o777)
  try {
    fs.writeFileSync(descriptor, patched)
    fs.fchownSync(descriptor, stat.uid, stat.gid)
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
  fs.renameSync(temporary, file)
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
}
console.log(JSON.stringify({ version, status: 'patched', backup }))
console.log(
  'Restart only the Slipway management container, then retry the normal update.'
)
