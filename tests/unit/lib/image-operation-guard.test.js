const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { acquire } = require('../../../api/lib/image-operation-guard')

test('shared deployment/rollback holds exclude cleanup; cleanup excludes all new users', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-guard-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const deploy = await acquire(root)
  const rollback = await acquire(root)
  await assert.rejects(acquire(root, 'cleanup'), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  await deploy()
  await assert.rejects(acquire(root, 'cleanup'), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  await rollback()
  const cleanup = await acquire(root, 'cleanup')
  await assert.rejects(acquire(root), { code: 'E_IMAGE_OPERATIONS_BUSY' })
  await assert.rejects(acquire(root, 'cleanup'), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  await cleanup()
  await (
    await acquire(root)
  )()
})
test('abandoned admission and use markers fail closed without stealing ownership', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'image-guard-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await acquire(root)
  await assert.rejects(acquire(root, 'cleanup'), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  await fs.mkdir(path.join(root, 'db/image-operation-guard/admission'))
  await assert.rejects(acquire(root), { code: 'E_IMAGE_OPERATIONS_BUSY' })
})
