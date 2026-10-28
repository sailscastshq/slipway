const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { randomUUID } = require('node:crypto')
const { create, ownerState } =
  require('../../../api/lib/image-operation-guard')._private
const owner = {
  bootId: randomUUID(),
  namespace: 'pid:[12345]',
  startTicks: '100'
}
const stat = (ticks) =>
  `19 (node worker) ${Array.from({ length: 20 }, (_, index) =>
    index === 19 ? ticks : '0'
  ).join(' ')}`
const record = () => ({
  version: 2,
  mode: 'use',
  token: randomUUID(),
  pid: 19,
  startedAt: Date.now(),
  owner
})
async function fixture(t, state = async () => 'dead') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-owner-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const api = create({ identity: async () => owner, state })
  const directory = path.join(root, 'db/image-operation-guard')
  await api.acquire(root)
  await api.acquire(root)
  return { root, directory, api }
}
const idle = () => ({ prepare: async () => true, verify: async () => true })

test('owner proof distinguishes live PID, reused PID and unavailable namespace without an age heuristic', async () => {
  const value = record()
  assert.equal(await ownerState(value, owner, async () => stat('100')), 'live')
  assert.equal(await ownerState(value, owner, async () => stat('101')), 'dead')
  assert.equal(
    await ownerState(value, owner, async () => {
      throw Object.assign(new Error(), { code: 'ENOENT' })
    }),
    'dead'
  )
  assert.equal(
    await ownerState(value, owner, async () => {
      throw Object.assign(new Error(), { code: 'EACCES' })
    }),
    'unknown'
  )
  assert.equal(
    await ownerState(value, { ...owner, bootId: randomUUID() }),
    'unknown'
  )
  assert.equal(
    await ownerState(value, { ...owner, namespace: 'pid:[2]' }),
    'unknown'
  )
  assert.equal(await ownerState({ pid: 19, startedAt: 1 }, owner), 'unknown')
  assert.equal(
    await ownerState({ ...value, mode: 'cleanup' }, owner),
    'unknown'
  )
})

test('new guards bind release to exact owned content, preserving a replacement owner', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-release-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const api = create({ identity: async () => owner })
  const release = await api.acquire(root, 'cleanup')
  const file = path.join(root, 'db/image-operation-guard/cleanup')
  const original = JSON.parse(await fs.readFile(file, 'utf8'))
  assert.equal(original.version, 2)
  assert.deepEqual(original.owner, owner)
  const replacement = { ...original, token: randomUUID() }
  await fs.writeFile(file, JSON.stringify(replacement))
  await assert.rejects(release(), /ownership changed/)
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), replacement)
})

test('verified dead use owners move to durable quarantine while exclusive cleanup is already held', async (t) => {
  const { root, directory, api } = await fixture(t)
  const original = await fs.readdir(directory)
  const release = await api.acquire(root, 'cleanup', { recovery: idle() })
  assert.equal(release.recoveredCount, 2)
  assert.deepEqual(await fs.readdir(directory), ['cleanup'])
  const retired = path.join(root, 'db/image-guard-retired')
  const [operation] = await fs.readdir(retired)
  const manifest = JSON.parse(
    await fs.readFile(path.join(retired, operation, 'manifest.json'), 'utf8')
  )
  assert.equal(manifest.reason, 'proved-dead-use-owner')
  assert.deepEqual(manifest.records.map((r) => r.name).sort(), original.sort())
  for (const item of manifest.records)
    assert.equal(
      await fs.readFile(path.join(retired, operation, item.name), 'utf8'),
      item.raw
    )
  await assert.rejects(api.acquire(root), { code: 'E_IMAGE_OPERATIONS_BUSY' })
  await release()
  assert.deepEqual(await fs.readdir(directory), [])
})

for (const classification of ['live', 'unknown'])
  test(`${classification} use owners never enter recovery`, async (t) => {
    const { root, directory, api } = await fixture(
      t,
      async () => classification
    )
    const original = await fs.readdir(directory)
    let called = false
    await assert.rejects(
      api.acquire(root, 'cleanup', {
        recovery: {
          ...idle(),
          prepare: async () => {
            called = true
            return true
          }
        }
      }),
      { code: 'E_IMAGE_OPERATIONS_BUSY' }
    )
    assert.equal(called, false)
    assert.deepEqual(await fs.readdir(directory), original)
  })
for (const failure of ['prepare', 'verify', 'timeout'])
  test(`recovery ${failure} failure preserves all use markers`, async (t) => {
    const { root, directory, api } = await fixture(t)
    const original = await fs.readdir(directory)
    const recovery = idle()
    if (failure === 'timeout') recovery.verify = () => new Promise(() => {})
    else recovery[failure] = async () => false
    await assert.rejects(api.acquire(root, 'cleanup', { recovery }), {
      code: 'E_IMAGE_OPERATIONS_BUSY'
    })
    assert.deepEqual(await fs.readdir(directory), original)
  })

test('a use marker appearing during inventory prevents retirement', async (t) => {
  const { root, directory, api } = await fixture(t)
  const recovery = idle()
  recovery.prepare = async () => {
    await fs.writeFile(
      path.join(directory, 'use-' + randomUUID()),
      JSON.stringify(record())
    )
    return true
  }
  await assert.rejects(api.acquire(root, 'cleanup', { recovery }), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  assert.equal((await fs.readdir(directory)).length, 3)
})

test('cleanup and legacy records remain held even when all callbacks would allow recovery', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-guard-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const directory = path.join(root, 'db/image-operation-guard')
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(
    path.join(directory, 'use-' + randomUUID()),
    JSON.stringify({ pid: 19, startedAt: 1 })
  )
  const api = create({ identity: async () => owner })
  await assert.rejects(api.acquire(root, 'cleanup', { recovery: idle() }), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  await fs.writeFile(path.join(directory, 'cleanup'), JSON.stringify(record()))
  await assert.rejects(api.acquire(root, 'cleanup', { recovery: idle() }), {
    code: 'E_IMAGE_OPERATIONS_BUSY'
  })
  assert.equal((await fs.readdir(directory)).length, 2)
})

test('a partial quarantine failure restores earlier moves and keeps every original guard', async (t) => {
  const { root, directory, api } = await fixture(t)
  const original = await fs.readdir(directory)
  const rename = fs.rename
  let moves = 0
  fs.rename = async (from, to) => {
    if (to.includes('image-guard-retired') && ++moves === 2)
      throw new Error('fixture move failure')
    return rename(from, to)
  }
  try {
    await assert.rejects(
      api.acquire(root, 'cleanup', { recovery: idle() }),
      /recovery failed/
    )
  } finally {
    fs.rename = rename
  }
  assert.deepEqual((await fs.readdir(directory)).sort(), original.sort())
})

test('read-only guard inspection shares dead-owner classification without creating or retiring files', async (t) => {
  let classification = 'dead'
  const { root, directory, api } = await fixture(t, async () => classification)
  const original = await fs.readdir(directory)
  assert.deepEqual(await api.inspect(root), { state: 'recoverable', count: 2 })
  classification = 'live'
  assert.deepEqual(await api.inspect(root), { state: 'active', count: 2 })
  classification = 'unknown'
  assert.deepEqual(await api.inspect(root), { state: 'unverified', count: 2 })
  assert.deepEqual(await fs.readdir(directory), original)
  await assert.rejects(fs.stat(path.join(root, 'db/image-guard-retired')), {
    code: 'ENOENT'
  })
})

test('owner becoming live during recovery preparation preserves exact original records', async (t) => {
  let classification = 'dead'
  const { root, directory, api } = await fixture(t, async () => classification)
  const original = await fs.readdir(directory)
  await assert.rejects(
    api.acquire(root, 'cleanup', {
      recovery: {
        prepare: async () => {
          classification = 'live'
          return true
        },
        verify: async () => true
      }
    }),
    { code: 'E_IMAGE_OPERATIONS_BUSY' }
  )
  assert.deepEqual(await fs.readdir(directory), original)
})

test('concurrent recovery admits exactly one cleanup and retires each record only once', async (t) => {
  const { root, directory, api } = await fixture(t)
  const attempts = await Promise.allSettled([
    api.acquire(root, 'cleanup', { recovery: idle() }),
    api.acquire(root, 'cleanup', { recovery: idle() })
  ])
  assert.equal(
    attempts.filter((result) => result.status === 'fulfilled').length,
    1
  )
  assert.equal(
    attempts.find((result) => result.status === 'rejected').reason.code,
    'E_IMAGE_OPERATIONS_BUSY'
  )
  assert.deepEqual(await fs.readdir(directory), ['cleanup'])
  assert.equal(
    (await fs.readdir(path.join(root, 'db/image-guard-retired'))).length,
    1
  )
  await attempts.find((result) => result.status === 'fulfilled').value()
})

test('versioned container ownership is required for cross-namespace proof, never inferred for legacy records', async () => {
  const value = record()
  const other = { ...owner, namespace: 'pid:[42]' }
  let calls = 0
  const containers = {
    valid: (value) => value?.id === 'immutable',
    state: async () => {
      calls++
      return 'dead'
    }
  }
  assert.equal(await ownerState(value, other, null, containers), 'unknown')
  assert.equal(calls, 0)
  value.version = 3
  assert.equal(await ownerState(value, other, null, containers), 'unknown')
  value.owner = { ...owner, container: { id: 'immutable' } }
  assert.equal(await ownerState(value, other, null, containers), 'dead')
  assert.equal(calls, 1)
})

test('malformed, symlinked and oversized records remain unverifiable without retirement', async (t) => {
  for (const kind of ['malformed', 'symlink', 'oversized']) {
    const { root, directory, api } = await fixture(t)
    const [name] = await fs.readdir(directory)
    const file = path.join(directory, name)
    if (kind === 'malformed') await fs.writeFile(file, '{broken')
    if (kind === 'oversized') await fs.writeFile(file, ' '.repeat(4097))
    if (kind === 'symlink') {
      await fs.unlink(file)
      await fs.symlink(
        path.join(directory, (await fs.readdir(directory))[0]),
        file
      )
    }
    assert.equal((await api.inspect(root)).state, 'unverified')
    await assert.rejects(api.acquire(root, 'cleanup', { recovery: idle() }), {
      code: 'E_IMAGE_OPERATIONS_BUSY'
    })
    assert.equal((await fs.readdir(directory)).length, 2)
    await assert.rejects(fs.stat(path.join(root, 'db/image-guard-retired')), {
      code: 'ENOENT'
    })
  }
})
