const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const prepare = require('../../api/lib/upgrade-fresh-storage')
test('fresh storage creates only missing empty catalogs and is idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-upgrade-'))
  try {
    prepare(directory)
    assert.deepEqual(fs.readdirSync(directory).sort(), [
      'analytics.db',
      'app.db',
      'observability.db',
      'stash.db'
    ])
    const before = fs
      .readdirSync(directory)
      .map((name) => fs.statSync(path.join(directory, name)).ino)
    prepare(directory)
    assert.deepEqual(
      fs
        .readdirSync(directory)
        .map((name) => fs.statSync(path.join(directory, name)).ino),
      before
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
for (const mode of ['existing-schema', 'view', 'session', 'symlink'])
  test(`fresh storage rejects ${mode} without creating other files or deleting data`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-reject-'))
    try {
      if (mode === 'session')
        fs.writeFileSync(
          path.join(directory, 'session.db'),
          'protected-session'
        )
      else if (mode === 'symlink')
        fs.symlinkSync('/missing-fixture', path.join(directory, 'stash.db'))
      else {
        const db = new Database(path.join(directory, 'stash.db'))
        db.exec(
          mode === 'view'
            ? 'CREATE VIEW existing AS SELECT 1'
            : 'CREATE TABLE existing(value TEXT)'
        )
        db.close()
      }
      const before = fs.readdirSync(directory)
      assert.throws(() => prepare(directory), { code: 'upgradeHostTarget' })
      assert.deepEqual(fs.readdirSync(directory), before)
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
test('host command missing or invalid arguments return parseable errors before Docker calls', () => {
  for (const args of [
    [],
    ['apply', '--image'],
    ['plan', '--image', '--instance'],
    ['invalid', '--bad', 'value']
  ]) {
    try {
      execFileSync(
        'bash',
        [path.resolve(__dirname, '../../scripts/upgrade-host.sh'), ...args],
        { stdio: ['ignore', 'pipe', 'pipe'] }
      )
      assert.fail('must fail')
    } catch (error) {
      assert.equal(error.status, 2)
      assert.equal(JSON.parse(error.stderr.toString()).success, false)
    }
  }
})
