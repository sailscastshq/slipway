const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const enabled =
  process.platform === 'linux' && process.env.SLIPWAY_FULL_IMAGE_FIXTURE === '1'
test(
  'production native launcher verifies the real host ABI and rejects wrong checksum before any image or storage operation',
  { skip: !enabled },
  () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-verify-'))
    const args = [
      'scripts/upgrade-host-native.sh',
      'verify',
      '--bundle',
      process.env.SLIPWAY_NATIVE_HOST_BUNDLE_ARCHIVE,
      '--state-dir',
      directory,
      '--bundle-sha256'
    ]
    try {
      const output = execFileSync(
        'bash',
        [...args, process.env.SLIPWAY_NATIVE_HOST_BUNDLE_SHA],
        { encoding: 'utf8', timeout: 30000 }
      )
      const value = JSON.parse(output)
      assert.equal(value.success, true)
      assert.equal(value.version, '0.0.88')
      assert.equal(value.arch, process.arch)
      assert.deepEqual(fs.readdirSync(directory), [])
      assert.throws(
        () =>
          execFileSync('bash', [...args, 'f'.repeat(64)], {
            stdio: 'pipe',
            timeout: 30000
          }),
        (error) =>
          error.status === 2 &&
          error.stderr.toString().includes('upgradeHostBundle')
      )
      assert.deepEqual(fs.readdirSync(directory), [])
      const bundle = process.env.SLIPWAY_NATIVE_HOST_BUNDLE_DIR
      const manifest = JSON.parse(
        fs.readFileSync(path.join(bundle, 'host-manifest.json'))
      )
      for (const file of manifest.files)
        assert.equal(
          crypto
            .createHash('sha256')
            .update(fs.readFileSync(path.join(bundle, file.path)))
            .digest('hex'),
          file.sha256
        )
      assert.equal(
        require(path.join(
          bundle,
          'api/lib/upgrade-host-program'
        )).officialImage(
          'localhost:1234/slipway-full-fixture@sha256:' + 'a'.repeat(64)
        ),
        false
      )
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
test(
  'whole native controller deadline reaps its registered detached SQLite worker and leaves the database usable',
  { skip: !enabled },
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'native-deadline-'))
    const Database = require('better-sqlite3')
    const filename = path.join(directory, 'db')
    const db = new Database(filename)
    db.exec('CREATE TABLE notes(id INTEGER PRIMARY KEY, title TEXT)')
    db.close()
    try {
      const native = require(path.join(
        process.env.SLIPWAY_NATIVE_HOST_BUNDLE_DIR,
        'scripts/upgrade-host-native.cjs'
      ))
      const result = await native.supervise(
        {
          bundleDirectory: process.env.SLIPWAY_NATIVE_HOST_BUNDLE_DIR,
          directory,
          filename,
          started: path.join(directory, 'started'),
          blockedWorker: path.resolve(
            __dirname,
            'fixtures/blocked-upgrade-worker.cjs'
          )
        },
        {
          worker: path.resolve(
            __dirname,
            'fixtures/upgrade-native-blocked-worker.cjs'
          ),
          timeoutMs: 1000
        }
      )
      assert.equal(result.success, false)
      assert.equal(result.code, 'upgradeWorkerTimeout')
      const pid = Number(
        fs.readFileSync(path.join(directory, 'started'), 'utf8')
      )
      try {
        assert.equal(
          fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ').pop()[0],
          'Z'
        )
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      const reopened = new Database(filename)
      assert.equal(reopened.pragma('integrity_check', { simple: true }), 'ok')
      reopened.exec('BEGIN IMMEDIATE; ROLLBACK')
      reopened.close()
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
