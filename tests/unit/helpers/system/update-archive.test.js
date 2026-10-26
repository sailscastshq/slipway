const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const load = async (file, sails, extras = {}) => {
  const context = { module: { exports: {} }, require, sails, ...extras }
  vm.runInNewContext(await fs.readFile(path.resolve(file), 'utf8'), context)
  return context.module.exports
}
for (const unavailable of [false, true])
  test(`updater remote archival ${
    unavailable
      ? 'retains and backs off unavailable storage'
      : 'resumes once and retains local recovery copies'
  }`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'updater-archive-'))
    const directory = path.join(root, 'db/system-backups', crypto.randomUUID())
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'system.tar.gz'), 'fixture archive')
    await fs.writeFile(
      path.join(directory, 'manifest.json'),
      JSON.stringify({
        databases: Array.from({ length: 4 }, () => ({
          integrity: 'ok',
          foreignKeys: 'ok'
        }))
      })
    )
    await fs.writeFile(path.join(directory, 'remote-pending.json'), '{}')
    let uploads = 0,
      configReads = 0
    const sails = {
      config: {
        appPath: root,
        custom: {
          databaseOperations: { backupMaxBytes: 1024, backupTimeoutMs: 1000 }
        }
      },
      log: { warn() {} },
      helpers: {
        backup: {
          getStorageConfig: async () => {
            configReads++
            if (unavailable) throw Error('Storage unavailable')
            return { provider: 's3', bucket: 'fixture-private' }
          },
          uploadObject: {
            with: async (input) => {
              uploads++
              assert.ok(input.objectKey.startsWith('backups/slipway-system/'))
              assert.equal(
                input.sourcePath,
                path.join(directory, 'system.tar.gz')
              )
              return { bytes: 15 }
            }
          }
        }
      }
    }
    try {
      const helper = await load(
        'api/helpers/system/archive-update-backup.js',
        sails
      )
      const first = await helper.fn()
      assert.equal(first.archived, !unavailable)
      await helper.fn()
      assert.equal(configReads, 1)
      assert.equal(uploads, unavailable ? 0 : 1)
      assert.equal(
        await fs.readFile(path.join(directory, 'system.tar.gz'), 'utf8'),
        'fixture archive'
      )
      if (unavailable) {
        const pending = JSON.parse(
          await fs.readFile(path.join(directory, 'remote-pending.json'), 'utf8')
        )
        assert.ok(pending.nextAttemptAt > Date.now())
      } else {
        const receipt = JSON.parse(
          await fs.readFile(path.join(directory, 'remote.json'), 'utf8')
        )
        assert.equal(receipt.provider, 's3')
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
test('closing SSE during a status read does not leave an interval or send to a closed response', async () => {
  let close,
    resolve,
    intervals = 0,
    sent = 0
  const pending = new Promise((r) => (resolve = r))
  const sails = { helpers: { system: { getUpdateStatus: () => pending } } }
  const controller = await load(
    'api/controllers/system/stream-update.js',
    sails,
    {
      setInterval() {
        intervals++
        return 1
      },
      clearInterval() {}
    }
  )
  const running = controller.fn.call({
    res: {
      sse: () => ({
        send() {
          sent++
        },
        onClose(fn) {
          close = fn
        },
        wait() {
          return null
        }
      })
    }
  })
  close()
  resolve({ phase: 'waiting' })
  await running
  assert.equal(intervals, 0)
  assert.equal(sent, 0)
})

test('new releases ignore update availability cached by the previous process version', async () => {
  let fetches = 0
  const sails = {
    config: { slipway: { version: '0.0.122' } },
    cache: {
      get: async () => ({ currentVersion: '0.0.121', updateAvailable: true }),
      set: async () => {}
    },
    log: { warn() {} }
  }
  const helper = await load('api/helpers/system/check-for-updates.js', sails, {
    AbortSignal,
    fetch: async () => {
      fetches++
      return { ok: true, json: async () => ({ tag_name: 'v0.0.122' }) }
    }
  })
  const result = await helper.fn({ skipCache: false })
  assert.equal(fetches, 1)
  assert.equal(result.currentVersion, '0.0.122')
  assert.equal(result.updateAvailable, false)
})
