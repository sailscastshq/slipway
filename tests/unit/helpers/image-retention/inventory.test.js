const { test } = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const util = require('node:util')
const source = fs.readFileSync(
  require.resolve('../../../../api/helpers/image-retention/get-inventory'),
  'utf8'
)
const imageId = 'sha256:' + 'a'.repeat(64)
const containerId = 'b'.repeat(64)
function fixture(responses) {
  const calls = []
  function execFile() {
    throw new Error('No real command may run')
  }
  execFile[util.promisify.custom] = async (binary, args, options) => {
    calls.push(args)
    assert.equal(binary, 'fixture-docker')
    assert.ok(options.timeout > 0)
    if (!responses.length) throw new Error('Unexpected inventory command')
    return { stdout: responses.shift() }
  }
  const context = {
    module: { exports: {} },
    sails: { config: { docker: { binaryPath: 'fixture-docker' } } },
    require: (name) =>
      name === 'node:child_process' ? { execFile } : require(name)
  }
  vm.runInNewContext(source, context)
  return {
    run: () =>
      context.module.exports.fn({
        policy: { maxImages: 3, maxContainers: 3, inspectBatchSize: 2 }
      }),
    calls
  }
}
const image = {
  id: imageId,
  created: '2026-01-01T00:00:00Z',
  size: 100,
  tags: null,
  digests: null
}
const container = { id: containerId, imageId }
test('inventory includes all stopped containers and normalizes empty Docker tag arrays', async () => {
  const f = fixture([
    imageId,
    containerId,
    JSON.stringify(image),
    JSON.stringify(container),
    containerId
  ])
  const result = await f.run()
  assert.equal(result.images.length, 1)
  assert.equal(result.images[0].tags.length, 0)
  assert.equal(result.containers[0].imageId, imageId)
  assert.ok(f.calls[1].includes('--all'))
  assert.equal(f.calls.filter((args) => args[1] === 'rm').length, 0)
})
test('partial inspections, abbreviated IDs and unresolved container images fail closed', async () => {
  await assert.rejects(
    fixture(['short-image', '']).run(),
    /incomplete image ID/
  )
  await assert.rejects(
    fixture([imageId, containerId, '', JSON.stringify(container)]).run(),
    /inspection was incomplete/
  )
  await assert.rejects(
    fixture([
      imageId,
      containerId,
      JSON.stringify(image),
      JSON.stringify({ ...container, imageId: 'sha256:' + 'c'.repeat(64) })
    ]).run(),
    /resolve a container image/
  )
})
test('new containers invalidate inventory rather than silently omitting a new reference', async () => {
  await assert.rejects(
    fixture([imageId, '', JSON.stringify(image), containerId]).run(),
    /Containers changed/
  )
})
