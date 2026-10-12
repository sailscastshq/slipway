const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const helper = require('../../../../api/helpers/dock/get-models')
function fixture(sails) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dock-preview-cache-'))
  const config = path.join(root, 'config.json'),
    calls = path.join(root, 'calls.jsonl'),
    binary = path.join(root, 'docker')
  const record = {
    descriptor: {
      Id: 'container-1',
      Image: 'sha256:image-1',
      State: { Running: true, StartedAt: 'first' },
      Config: { Env: ['PUBLIC_LABEL=synthetic'], WorkingDir: '/app' },
      HostConfig: { NetworkMode: 'fixture' },
      Mounts: []
    },
    models: {
      invoice: {
        identity: 'invoice',
        tableName: 'invoices',
        primaryKey: 'id',
        attributes: { paidAt: { type: 'number', columnName: 'paid_at' } }
      }
    }
  }
  const save = () => fs.writeFileSync(config, JSON.stringify(record))
  save()
  fs.writeFileSync(
    binary,
    `#!${
      process.execPath
    }\nconst fs=require('node:fs');const args=process.argv.slice(2);const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(
      config
    )},'utf8'));const log=event=>fs.appendFileSync(${JSON.stringify(
      calls
    )},JSON.stringify({event,args})+'\\n');log(args[0]);if(args[0]==='inspect'){const r=read();if(r.inspectFail)process.exit(1);process.stdout.write(JSON.stringify([r.descriptor]));}else if(args[0]==='run'){process.stdin.resume();process.stdin.on('end',()=>{const r=read();log('snapshot');setTimeout(()=>{if(r.fail)process.exit(1);process.stdout.write(JSON.stringify(r.models));},100);});}`,
    { mode: 0o755 }
  )
  const original = sails.config.docker
  sails.config.docker = { ...original, binaryPath: binary }
  helper._private.clearPreviewCache()
  return {
    record,
    save,
    calls: () =>
      fs.existsSync(calls)
        ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse)
        : [],
    close() {
      helper._private.clearPreviewCache()
      sails.config.docker = original
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
}
test('preview snapshots are cloned, explicitly refreshable and never used by fresh validation', async ({
  sails
}) => {
  const f = fixture(sails)
  try {
    const cold = await helper.fn({ containerName: 'fixture', preview: true })
    assert.equal(cold.timings.cacheHit, false)
    cold.models.invoice.attributes.paidAt.type = 'string'
    const warm = await helper.fn({ containerName: 'fixture', preview: true })
    assert.equal(warm.timings.cacheHit, true)
    assert.equal(warm.models.invoice.attributes.paidAt.type, 'number')
    f.record.models.invoice.attributes.paidAt.type = 'ref'
    f.save()
    const forced = await helper.fn({
      containerName: 'fixture',
      preview: true,
      forceRefresh: true
    })
    assert.equal(forced.timings.cacheHit, false)
    assert.equal(forced.models.invoice.attributes.paidAt.type, 'ref')
    f.record.models.invoice.attributes.paidAt.type = 'boolean'
    f.save()
    const validation = await helper.fn({
      containerName: 'fixture',
      forceRefresh: true
    })
    assert.equal(validation.timings.cacheHit, false)
    assert.equal(validation.models.invoice.attributes.paidAt.type, 'boolean')
    assert.equal(f.calls().filter((c) => c.event === 'run').length, 3)
    assert.equal(f.calls().filter((c) => c.event === 'inspect').length, 4)
  } finally {
    f.close()
  }
})
test('container replacement, image, restart, config and mounts invalidate preview snapshots', async ({
  sails
}) => {
  const f = fixture(sails)
  try {
    await helper.fn({ containerName: 'fixture', preview: true })
    for (const change of [
      (r) => (r.Id = 'container-2'),
      (r) => (r.Image = 'sha256:image-2'),
      (r) => (r.State.StartedAt = 'second'),
      (r) => r.Config.Env.push('PUBLIC_LABEL=changed'),
      (r) => (r.Config.WorkingDir = '/new'),
      (r) => r.Mounts.push({ Source: '/safe/new', Destination: '/app' }),
      (r) => (r.HostConfig.NetworkMode = 'new-network')
    ]) {
      change(f.record.descriptor)
      f.save()
      const value = await helper.fn({ containerName: 'fixture', preview: true })
      assert.equal(value.timings.cacheHit, false)
    }
    f.record.descriptor.State.Running = false
    f.save()
    assert.ok(
      (await helper.fn({ containerName: 'fixture', preview: true })).error
    )
    assert.equal(f.calls().filter((c) => c.event === 'run').length, 8)
  } finally {
    f.close()
  }
})
test('expired and failed previews are not reused and snapshots remain bounded', async ({
  sails
}) => {
  const f = fixture(sails),
    now = performance.now
  try {
    await helper.fn({ containerName: 'fixture', preview: true })
    performance.now = () => now.call(performance) + 11000
    assert.equal(
      (await helper.fn({ containerName: 'fixture', preview: true })).timings
        .cacheHit,
      false
    )
    performance.now = now
    f.record.fail = true
    f.save()
    assert.ok(
      (
        await helper.fn({
          containerName: 'fixture',
          preview: true,
          forceRefresh: true
        })
      ).error
    )
    f.record.fail = false
    f.save()
    assert.equal(
      (await helper.fn({ containerName: 'fixture', preview: true })).timings
        .cacheHit,
      false
    )
    for (let i = 0; i < 18; i++)
      await helper.fn({ containerName: 'bounded-' + i, preview: true })
    const stats = helper._private.previewCacheStats()
    assert.ok(stats.entries <= 16)
    assert.ok(stats.bytes <= 8 * 1024 * 1024)
  } finally {
    performance.now = now
    f.close()
  }
})
test('mutation validation does not join an inspection started by a preview', async ({
  sails
}) => {
  const f = fixture(sails)
  try {
    const pending = helper.fn({ containerName: 'fixture', preview: true })
    const limit = Date.now() + 5000
    while (!f.calls().some((c) => c.event === 'snapshot')) {
      if (Date.now() > limit) throw Error('Snapshot did not start')
      await new Promise((r) => setTimeout(r, 5))
    }
    f.record.models.invoice.attributes.paidAt.type = 'string'
    f.save()
    const fresh = helper.fn({ containerName: 'fixture', forceRefresh: true })
    const [preview, validation] = await Promise.all([pending, fresh])
    assert.equal(preview.models.invoice.attributes.paidAt.type, 'number')
    assert.equal(validation.models.invoice.attributes.paidAt.type, 'string')
    assert.equal(f.calls().filter((c) => c.event === 'run').length, 2)
  } finally {
    f.close()
  }
})
