const { test } = require('sounding'),
  assert = require('node:assert/strict'),
  fs = require('node:fs/promises'),
  os = require('node:os'),
  path = require('node:path')
const execFile = require('node:util').promisify(
  require('node:child_process').execFile
)
test('unopenable optional Wake storage does not prevent the Sails ORM and primary database from starting', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wake-startup-'))
  await fs.symlink(
    path.resolve('node_modules'),
    path.join(directory, 'node_modules'),
    'dir'
  )
  const corrupt = path.join(directory, 'analytics.db')
  await fs.writeFile(corrupt, 'this is not a SQLite database')
  try {
    const { stdout } = await execFile(
      process.execPath,
      [path.resolve('tests/support/wake-startup-child.cjs'), directory],
      { timeout: 20000 }
    )
    const result = JSON.parse(stdout.trim())
    assert.equal(result.fallback, true)
    assert.equal(result.url, ':memory:')
    assert.equal(
      await fs.readFile(corrupt, 'utf8'),
      'this is not a SQLite database'
    )
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
