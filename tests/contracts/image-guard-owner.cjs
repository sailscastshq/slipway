const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const guard = require('../../api/lib/image-operation-guard')
const command = promisify(execFile)

test(
  'Linux process incarnation proves an exited child use owner dead and preserves live owners',
  { skip: process.platform !== 'linux' },
  async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-linux-proof-'))
    try {
      const modulePath = require.resolve('../../api/lib/image-operation-guard')
      await command(process.execPath, [
        '-e',
        `require(${JSON.stringify(
          modulePath
        )}).acquire(process.argv[1]).then(()=>process.exit(0))`,
        root
      ])
      const directory = path.join(root, 'db/image-operation-guard')
      const [name] = await fs.readdir(directory)
      const record = JSON.parse(
        await fs.readFile(path.join(directory, name), 'utf8')
      )
      assert.equal(record.version, 2)
      assert.ok(record.owner)
      const live = await guard.acquire(root)
      const recovery = { prepare: async () => true, verify: async () => true }
      await assert.rejects(guard.acquire(root, 'cleanup', { recovery }), {
        code: 'E_IMAGE_OPERATIONS_BUSY'
      })
      await live()
      const cleanup = await guard.acquire(root, 'cleanup', { recovery })
      assert.equal(cleanup.recoveredCount, 1)
      assert.deepEqual(await fs.readdir(directory), ['cleanup'])
      await cleanup()
      const [operation] = await fs.readdir(
        path.join(root, 'db/image-guard-retired')
      )
      assert.equal(
        await fs.readFile(
          path.join(root, 'db/image-guard-retired', operation, name),
          'utf8'
        ),
        JSON.stringify(record)
      )
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  }
)
