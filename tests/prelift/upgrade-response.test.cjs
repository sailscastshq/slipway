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
          allowContainerDispatch: true,
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
        allowContainerDispatch: true,
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

for (const inertia of [false, true]) {
  for (const method of ['apply', 'resume']) {
    test(`${
      inertia ? 'Inertia' : 'REST'
    } ${method} requires the host command without dispatch`, async () => {
      const res = response(),
        req = { get: () => inertia, session: {} }
      await action(
        method,
        { req, res },
        {},
        {
          broker: async () => {
            throw new Error('unexpected privileged dispatch')
          },
          advertised: async () => {
            throw new Error('unexpected image pull')
          }
        }
      )
      assert.equal(res.statusCode, inertia ? 303 : 409)
      if (inertia) {
        assert.equal(res.Location, '/settings/update')
        assert.match(req.session.errors.approval, /one-time host/)
      } else assert.equal(res.body.code, 'upgradeHostRequired')
    })
  }
}
test('host review returns a pinned command and requires separately verified artifacts', async () => {
  const image = 'ghcr.io/sailscastshq/slipway@sha256:' + 'a'.repeat(64)
  const result = await action(
    'plan',
    { req: {}, res: response() },
    {},
    {
      advertised: async () => image,
      broker: async () => {
        throw new Error('unexpected dispatch')
      }
    }
  )
  assert.equal(result.execution, 'host-native')
  assert.equal(result.requiresVerifiedBundle, true)
  assert.ok(result.hostCommand.includes(image))
  assert.ok(result.hostCommand.includes('<verified-archive-sha256>'))
  assert.ok(!result.reviewHash)
})
test('redirected status view never starts a privileged helper', async () => {
  const host = require('../../api/lib/upgrade-host-review')
  const previous = host.status,
    previousSails = global.sails
  const res = response(),
    saved = { id: 'fixture-id', recoveryRequired: true }
  try {
    global.sails = {
      helpers: {
        system: { checkForUpdates: async () => ({ latestVersion: '0.0.88' }) }
      }
    }
    host.status = () => saved
    const result =
      await require('../../api/controllers/system/view-update').fn.call(
        { req: {}, res },
        { upgradeId: saved.id }
      )
    assert.deepEqual(result.props.upgrade, saved)
    assert.equal(result.props.hostNative, true)
    assert.equal(res.listenerCount('finish'), 0)
  } finally {
    host.status = previous
    if (previousSails === undefined) delete global.sails
    else global.sails = previousSails
  }
})
