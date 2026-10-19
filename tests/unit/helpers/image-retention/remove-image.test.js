const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const remove = require('../../../../api/helpers/image-retention/remove-image')
const getPlan = require('../../../../api/helpers/image-retention/get-plan')
const getPolicy = require('../../../../api/helpers/image-retention/get-policy')
const guard = require('../../../../api/lib/image-operation-guard')
const id = (n) => 'sha256:' + String(n).padStart(64, '0')
const tag = (n) => `slipway/fixture-${n}:${n}`

async function fixture(t, behavior = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-alias-test-'))
  const file = path.join(root, 'state.json')
  const binary = path.join(root, 'fake-docker')
  const names = [
    'sails',
    'Setting',
    'Deployment',
    'App',
    'DeploymentJob',
    'Service',
    'CleanupOperation'
  ]
  const original = Object.fromEntries(names.map((name) => [name, global[name]]))
  await fs.mkdir(path.join(root, 'db'))
  const image = {
    id: id(1),
    tags: [tag(1)],
    digests: [],
    size: 1000,
    created: '2020-01-01T00:00:00Z'
  }
  const data = { images: [image], containers: [], commands: [], behavior }
  await fs.writeFile(file, JSON.stringify(data))
  await fs.writeFile(
    binary,
    `#!${process.execPath}\n` +
      `const file=${JSON.stringify(file)};\n` +
      String.raw`
const fs = require('node:fs'); const data = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2); data.commands.push(args);
const save = () => fs.writeFileSync(file, JSON.stringify(data));
const fail = (message) => { save(); console.error(message); process.exit(1) };
if (args[1] === 'inspect') {
  if (data.behavior.newTagOnInspect) data.images[0].tags.push('outside/keep:latest');
  if (data.behavior.retargetOnInspect) {
    data.images[0].tags = data.images[0].tags.filter((tag) => tag !== 'slipway/fixture-1:1');
    data.images.push({ ...data.images[0], id: 'sha256:' + '9'.repeat(64), tags: ['slipway/fixture-1:1'] });
  }
  save();
  for (const ref of args.slice(4)) {
    const image = data.images.find((image) => image.id === ref || image.tags.includes(ref));
    if (!image) fail('Error response from daemon: No such image: ' + ref);
    console.log(JSON.stringify(image));
  }
} else if (args[1] === 'rm') {
  const ref = args.at(-1);
  if (data.behavior.extraTagAtRemoval) data.images[0].tags.push('outside/racing:latest');
  if (data.behavior.systemError) fail('Cannot connect to the Docker daemon');
  if (data.behavior.conflict && (data.behavior.conflict === ref || data.behavior.conflict === true))
    fail('Error response from daemon: conflict: image is referenced in multiple repositories');
  const image = data.images.find((image) => image.id === ref || image.tags.includes(ref));
  if (!image) fail('No such image: ' + ref);
  if (image.id === ref && image.tags.length > 1) fail('conflict: image is referenced in multiple repositories');
  if (image.id === ref) data.images = data.images.filter((item) => item !== image);
  else {
    image.tags = image.tags.filter((tag) => tag !== ref);
    if (!image.tags.length) data.images = data.images.filter((item) => item !== image);
  }
  if (data.behavior.protectAfterUntag && data.images.length) data.containers.push({ id: 'new-container', imageId: image.id });
  save();
} else fail('Unexpected fake Docker command');
`
  )
  await fs.chmod(binary, 0o755)
  const deployments = [1, 2].map((n) => ({
    id: n,
    app: 1,
    environment: 1,
    imageName: tag(n),
    status: 'failed',
    createdAt: 1
  }))
  for (const name of names.slice(1))
    global[name] = {
      find: () => ({
        select: () => ({
          limit: async () =>
            name === 'Deployment'
              ? deployments
              : name === 'App'
              ? [{ id: 1, environment: 1 }]
              : []
        })
      })
    }
  const read = async () => JSON.parse(await fs.readFile(file, 'utf8'))
  const write = async (data) => fs.writeFile(file, JSON.stringify(data))
  global.sails = {
    config: {
      appPath: root,
      docker: { binaryPath: binary },
      imageRetention: { remove: true }
    },
    helpers: {
      imageRetention: {
        getPolicy: () => getPolicy.fn(),
        getInventory: {
          with: async () => {
            const data = await read()
            return { images: data.images, containers: data.containers }
          }
        },
        getPlan: { with: (input) => getPlan.fn(input) }
      }
    }
  }
  const policy = await getPolicy.fn()
  const input = {
    imageId: id(1),
    tags: [tag(1)],
    policy,
    deadline: Date.now() + 30000
  }
  t.after(async () => {
    for (const name of names) {
      if (original[name] === undefined) delete global[name]
      else global[name] = original[name]
    }
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, read, write, input }
}

test('single-tag deletion uses only the immutable ID and confirms absence without force', async (t) => {
  const { read, input } = await fixture(t)
  assert.deepEqual(await remove.fn(input), { removed: true, untagged: [] })
  const state = await read()
  assert.equal(state.images.length, 0)
  assert.deepEqual(
    state.commands.filter((args) => args[1] === 'rm'),
    [['image', 'rm', '--no-prune', id(1)]]
  )
})

test('multi-tag candidates are deferred with no Docker removal commands', async (t) => {
  const { read, write, input } = await fixture(t)
  const state = await read()
  state.images[0].tags.push(tag(2))
  input.tags.push(tag(2))
  await write(state)
  const result = await remove.fn(input)
  assert.equal(result.reason, 'multiple-image-tags')
  assert.equal(result.deferred, true)
  assert.deepEqual(result.untagged, [])
  assert.deepEqual((await read()).commands, [])
})

for (const behavior of [
  { retargetOnInspect: true },
  { newTagOnInspect: true }
]) {
  test(`inspection detects mapping changes: ${
    Object.keys(behavior)[0]
  }`, async (t) => {
    const { read, input } = await fixture(t, behavior)
    assert.equal((await remove.fn(input)).reason, 'image-tags-changed')
    assert.equal(
      (await read()).commands.filter((args) => args[1] === 'rm').length,
      0
    )
  })
}

for (const kind of ['outside', 'digest', 'container', 'pin', 'untagged']) {
  test(`a protected ${kind} reference is not removed`, async (t) => {
    const { read, write, input } = await fixture(t)
    const state = await read()
    if (kind === 'outside') state.images[0].tags.push('outside/keep:latest')
    if (kind === 'digest') state.images[0].digests.push('outside/keep@' + id(1))
    if (kind === 'container')
      state.containers.push({ id: 'running', imageId: id(1) })
    if (kind === 'untagged') {
      state.images[0].tags = []
      input.tags = []
    }
    if (kind === 'pin') {
      sails.config.imageRetention.pinnedImages = [tag(1)]
      input.policy = await getPolicy.fn()
    }
    await write(state)
    assert.equal(
      (await remove.fn(input)).reason,
      'protection-or-inventory-changed'
    )
    assert.deepEqual((await read()).commands, [])
  })
}

test('an extra tag arriving after inspection causes non-force ID conflict deferral', async (t) => {
  const { read, input } = await fixture(t, { extraTagAtRemoval: true })
  const result = await remove.fn(input)
  assert.equal(result.removed, false)
  assert.equal(result.reason, 'docker-conflict')
  assert.equal(result.deferred, true)
  const state = await read()
  assert.deepEqual(
    state.commands.filter((args) => args[1] === 'rm'),
    [['image', 'rm', '--no-prune', id(1)]]
  )
  assert.deepEqual(state.images[0].tags, [tag(1), 'outside/racing:latest'])
})

test('failed post-removal verification stops without claiming confirmed removal', async (t) => {
  const { read, input } = await fixture(t)
  const inventory = sails.helpers.imageRetention.getInventory.with
  sails.helpers.imageRetention.getInventory.with = async () => {
    if ((await read()).commands.some((args) => args[1] === 'rm'))
      throw new Error('fixture incomplete inventory')
    return inventory()
  }
  await assert.rejects(remove.fn(input), /incomplete inventory/)
  assert.equal(
    (await read()).commands.filter((args) => args[1] === 'rm').length,
    1
  )
})

test('the shared hold excludes deploy/rollback admission through removal verification', async (t) => {
  const { root, input } = await fixture(t)
  const release = await guard.acquire(root, 'cleanup')
  const inventory = sails.helpers.imageRetention.getInventory.with
  let checks = 0
  sails.helpers.imageRetention.getInventory.with = async () => {
    await assert.rejects(guard.acquire(root), {
      code: 'E_IMAGE_OPERATIONS_BUSY'
    })
    checks++
    return inventory()
  }
  try {
    assert.equal((await remove.fn(input)).removed, true)
  } finally {
    await release()
  }
  assert.ok(checks >= 2)
  await (
    await guard.acquire(root)
  )()
})

test('daemon failures remain systemic errors', async (t) => {
  const { input } = await fixture(t, { systemError: true })
  await assert.rejects(remove.fn(input), /Cannot connect to the Docker daemon/)
})

test('an expired run budget performs no Docker commands', async (t) => {
  const { read, input } = await fixture(t)
  input.deadline = Date.now() - 1
  assert.equal((await remove.fn(input)).reason, 'run-time-limit')
  assert.deepEqual((await read()).commands, [])
})
