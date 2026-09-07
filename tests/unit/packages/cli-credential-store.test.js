const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

test('CLI credentials are private and existing permissions are repaired', async ({
  expect
}) => {
  const { credentialStore } = await import(
    '../../../packages/cli/src/lib/credential-store.js'
  )
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-credentials-'))
  const directory = path.join(root, '.slipway')
  const file = path.join(directory, 'config.json')
  try {
    const store = credentialStore(directory)
    store.write({ token: 'test-only-token' })
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    fs.chmodSync(directory, 0o755)
    fs.chmodSync(file, 0o644)
    expect(store.read().token).toBe('test-only-token')
    expect(fs.statSync(directory).mode & 0o777).toBe(0o700)
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    const oldInode = fs.statSync(file).ino
    store.write({ token: 'replacement' })
    expect(fs.statSync(file).ino === oldInode).toBe(false)
    expect(store.read().token).toBe('replacement')
    expect(fs.readdirSync(directory)).toEqual(['config.json'])
    fs.unlinkSync(file)
    const target = path.join(root, 'outside')
    fs.writeFileSync(target, '{"token":"outside"}', { mode: 0o644 })
    fs.symlinkSync(target, file)
    let rejected = false
    try {
      store.read()
    } catch {
      rejected = true
    }
    expect(rejected).toBe(true)
    expect(fs.statSync(target).mode & 0o777).toBe(0o644)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
