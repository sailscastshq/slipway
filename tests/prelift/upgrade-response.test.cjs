const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { action } = require('../../api/lib/system-upgrade-action')
function response() {
  const res = new EventEmitter()
  res.status = (value) => {
    res.statusCode = value
    return res
  }
  res.set = (key, value) => {
    res[key] = value
    return res
  }
  res.json = res.send = (value) => {
    res.body = value
    return res
  }
  return res
}
for (const inertia of [false, true]) {
  test(`${
    inertia ? 'Inertia' : 'REST'
  } accepted response precedes host start and an early close cancels only unstarted work`, async () => {
    for (const finished of [false, true]) {
      const res = response(),
        req = { get: () => inertia, session: {} }
      let started = 0,
        canceled = 0
      await action(
        'apply',
        { req, res },
        { approval: 'a'.repeat(64), instanceId: 'fixture' },
        {
          broker: async () => ({
            apply: async () => ({
              result: { id: 'fixture-id', status: 'accepted' },
              start: async () => {
                started++
              },
              cancel: async () => {
                canceled++
              }
            })
          }),
          advertised: async () => 'fixture-image'
        }
      )
      assert.equal(res.statusCode, inertia ? 303 : 202)
      if (inertia)
        assert.equal(res.Location, '/settings/update?upgradeId=fixture-id')
      assert.equal(started, 0)
      if (finished) res.emit('finish')
      res.emit('close')
      assert.equal(started, finished && !inertia ? 1 : 0)
      assert.equal(canceled, finished ? 0 : 1)
    }
  })
  test(`${
    inertia ? 'Inertia' : 'REST'
  } failed approval stays neutral and returns native form/API error handling`, async () => {
    const res = response(),
      req = { get: () => inertia, session: {} }
    await action(
      'apply',
      { req, res },
      {},
      {
        broker: async () => {
          throw Object.assign(new Error('synthetic-secret'), {
            code: 'upgradeHostApproval'
          })
        }
      }
    )
    assert.equal(res.statusCode, inertia ? 303 : 409)
    assert.ok(!JSON.stringify(res.body).includes('synthetic-secret'))
    if (inertia) {
      assert.equal(res.Location, '/settings/update')
      assert.ok(req.session.errors.approval)
    } else assert.equal(res.body.code, 'upgradeHostApproval')
  })
}

test('Inertia redirected receipt page flushes before its owned controller starts', async () => {
  const module = require('../../api/lib/system-upgrade-action')
  const previousBroker = module.broker,
    previousSails = global.sails
  const res = response()
  let started = 0
  const saved = { id: 'fixture-id', phase: 'reviewed' }
  try {
    global.sails = {
      helpers: {
        system: { checkForUpdates: async () => ({ updateAvailable: true }) }
      },
      log: { warn() {} }
    }
    module.broker = async () => ({
      status: () => saved,
      start: async (id) => {
        assert.equal(id, saved.id)
        started++
      }
    })
    const result =
      await require('../../api/controllers/system/view-update').fn.call(
        { req: {}, res },
        { upgradeId: saved.id }
      )
    assert.deepEqual(result.props.upgrade, saved)
    assert.equal(started, 0)
    res.emit('finish')
    assert.equal(started, 1)
  } finally {
    module.broker = previousBroker
    if (previousSails === undefined) delete global.sails
    else global.sails = previousSails
  }
})
