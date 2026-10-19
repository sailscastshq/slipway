const { test } = require('node:test')
const assert = require('node:assert/strict')
const helper = require('../../../../api/helpers/deploy/resolve-recovery-target')
const recovery = require('../../../../api/lib/deployment-recovery')
const image = (n) => 'sha256:' + String(n).padStart(64, '0')
function fixture(t) {
  const names = ['sails', 'Setting', 'Deployment', 'DeploymentJob']
  const original = Object.fromEntries(names.map((name) => [name, global[name]]))
  t.after(() => {
    for (const name of names) {
      if (original[name] === undefined) delete global[name]
      else global[name] = original[name]
    }
  })
  const app = {
    id: 3,
    environment: 2,
    slug: 'web',
    currentDeployment: 9,
    imageId: image(9)
  }
  const target = {
    id: 4,
    app: 3,
    environment: 2,
    status: 'stopped',
    imageId: image(4)
  }
  const state = {
    version: 1,
    appId: '3',
    environmentId: '2',
    rejectedImages: [],
    current: {
      deploymentId: '9',
      imageId: image(9),
      promotedAt: 900,
      compatibility: 'schema-1'
    },
    previous: {
      deploymentId: '4',
      imageId: image(4),
      promotedAt: 400,
      compatibility: 'schema-1'
    }
  }
  const data = {
    busy: false,
    hold: false,
    missing: false,
    compatibility: 'schema-1',
    calls: []
  }
  global.Setting = {
    findOne: async ({ key }) =>
      key.startsWith(recovery.HOLD_PREFIX)
        ? data.hold
          ? { value: 'held' }
          : null
        : { value: JSON.stringify(state) }
  }
  global.Deployment = {
    findOne: async (criteria) =>
      String(target.id) === criteria.id &&
      target.app === criteria.app &&
      target.environment === criteria.environment &&
      criteria.status.in.includes(target.status)
        ? target
        : null
  }
  global.DeploymentJob = { count: async () => (data.busy ? 1 : 0) }
  global.sails = {
    helpers: {
      docker: {
        inspectDeploymentImage: {
          with: async ({ imageReference }) => {
            data.calls.push(imageReference)
            if (data.missing) throw new Error('missing local image')
            return {
              imageId: imageReference,
              compatibility:
                data.declarations &&
                Object.hasOwn(data.declarations, imageReference)
                  ? data.declarations[imageReference]
                  : data.compatibility
            }
          }
        }
      }
    }
  }
  const resolve = (extra = {}) => helper.fn({ app, checkBusy: true, ...extra })
  return { app, target, state, data, resolve }
}
test('stopped healthy predecessor is eligible and current, arbitrary or cross-app targets are not', async (t) => {
  const { resolve, target, data } = fixture(t)
  assert.equal(
    (await resolve({ deploymentId: '4', expectedCurrent: '9' })).available,
    true
  )
  assert.deepEqual(data.calls.sort(), [image(4), image(9)].sort())
  for (const deploymentId of ['9', '1'])
    assert.equal((await resolve({ deploymentId })).available, false)
  target.app = 99
  assert.equal((await resolve()).available, false)
})
test('failed deployments, missing images, stale current generation and busy work cannot become rollback targets', async (t) => {
  const { target, data, resolve } = fixture(t)
  target.status = 'failed'
  assert.equal((await resolve()).available, false)
  target.status = 'stopped'
  data.missing = true
  assert.equal((await resolve()).available, false)
  data.missing = false
  assert.match((await resolve({ expectedCurrent: '8' })).reason, /changed/)
  data.busy = true
  assert.match((await resolve()).reason, /progress/)
  assert.equal((await resolve({ checkBusy: false })).available, true)
  data.hold = true
  assert.match((await resolve()).reason, /operator/)
})
test('unlabelled images require acknowledgement while explicit conflicting declarations block recovery', async (t) => {
  const { data, state, resolve } = fixture(t)
  data.compatibility = null
  state.current.compatibility = state.previous.compatibility = null
  let result = await resolve()
  assert.equal(result.available, true)
  assert.equal(result.compatibilityStatus, 'unknown')
  assert.equal(result.requiresCompatibilityAcknowledgement, true)
  data.compatibility = 'schema-2'
  result = await resolve()
  assert.equal(result.available, false)
  assert.match(result.reason, /conflict/)
})
test('optional declarations distinguish known conflict, known match and one unknown side', async (t) => {
  const { data, state, resolve } = fixture(t)
  state.current.compatibility = 'schema-2'
  state.previous.compatibility = 'schema-1'
  data.declarations = { [image(9)]: 'schema-2', [image(4)]: 'schema-1' }
  assert.equal((await resolve()).available, false)
  state.current.compatibility = data.declarations[image(9)] = 'schema-1'
  assert.equal((await resolve()).requiresCompatibilityAcknowledgement, false)
  state.previous.compatibility = data.declarations[image(4)] = null
  assert.equal((await resolve()).available, true)
  assert.equal((await resolve()).requiresCompatibilityAcknowledgement, true)
})
test('rejected, same-image and malformed recovery metadata fail closed', async (t) => {
  const { state, resolve } = fixture(t)
  state.rejectedImages = [image(4)]
  assert.equal((await resolve()).available, false)
  state.rejectedImages = []
  state.previous.imageId = image(9)
  assert.equal((await resolve()).available, false)
})
