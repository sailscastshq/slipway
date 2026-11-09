const { test } = require('sounding')
const assert = require('node:assert/strict')
const App = require('../../../api/models/App')
const names = require('../../../api/lib/app-container-name')

for (const length of [62, 63, 64, 69, 255, 1024]) {
  for (const deploymentId of [undefined, 1053]) {
    test(`app container names bound ${length}-character ${
      deploymentId ? 'deployment' : 'stable'
    } names`, () => {
      const suffix = deploymentId === undefined ? '' : `-${deploymentId}`
      const project = 'p'.repeat(
        length - 'slipway--prod-studio'.length - suffix.length
      )
      const args = [project, 'prod', 'studio', deploymentId]
      const legacy = names.legacyName(...args)
      const actual = names.generateName(...args)
      assert.equal(legacy.length, length)
      assert.ok(actual.length <= 63)
      assert.match(actual, /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
      assert.equal(actual, names.generateName(...args))
      if (length <= 63) assert.equal(actual, legacy)
      else assert.notEqual(actual, legacy)
      if (deploymentId !== undefined) assert.ok(actual.endsWith(suffix))
    })
  }
}

test('short default and named apps retain their exact existing names', () => {
  for (const app of [undefined, '', 'app']) {
    assert.equal(
      names.generateName('project', 'production', app),
      'slipway-project-production'
    )
    assert.equal(
      names.generateName('project', 'production', app, 1053),
      'slipway-project-production-1053'
    )
  }
  assert.equal(
    names.generateName('project', 'production', 'studio'),
    'slipway-project-production-studio'
  )
  assert.equal(
    names.generateName('project', 'production', 'studio', 1053),
    'slipway-project-production-studio-1053'
  )
})

test('long names retain distinct complete project, environment, app and deployment identities', () => {
  const prefix = 'shared-'.repeat(12)
  const cases = [
    [prefix + 'one', 'production', 'studio', 1053],
    [prefix + 'two', 'production', 'studio', 1053],
    [prefix + 'one', 'staging', 'studio', 1053],
    [prefix + 'one', 'production', 'worker', 1053],
    [prefix + 'one', 'production', 'studio', 1054],
    [prefix + 'one', 'production', 'studio'],
    // Identical joined strings must not collapse distinct component boundaries.
    [prefix + 'one-production', 'studio', 'app', 1053]
  ]
  const generated = cases.map((args) => names.generateName(...args))
  assert.equal(new Set(generated).size, cases.length)
  for (const name of generated) assert.ok(name.length <= 63)
  const many = new Set(
    Array.from({ length: 10000 }, (_, index) =>
      names.generateName(prefix + index, 'production', 'studio', 1053)
    )
  )
  assert.equal(many.size, 10000)
})

test('model naming keeps legacy resource lookup and image tags unchanged', async () => {
  const original = global.Environment
  const project = 'studios-'.repeat(8)
  global.Environment = {
    findOne: ({ id }) => ({
      populate: async () =>
        id === 'missing'
          ? null
          : {
              slug: 'production',
              project: { slug: project }
            }
    })
  }
  try {
    const current = await App.generateDeployContainerName('env', 1053, 'studio')
    assert.equal(
      current,
      names.generateName(project, 'production', 'studio', 1053)
    )
    assert.ok(current.length <= 63)
    assert.equal(
      await App.generateContainerName('env', 'studio'),
      names.generateName(project, 'production', 'studio')
    )
    assert.equal(
      await App.generateDeployContainerName('env', 1053, 'studio', {
        legacy: true
      }),
      `slipway-${project}-production-studio-1053`
    )
    assert.equal(
      await App.generateImageName('env', 1053, 'studio'),
      `slipway/${project}-production-studio:1053`
    )
    assert.equal(await App.generateContainerName('missing'), null)
    assert.equal(await App.generateDeployContainerName('missing', 1053), null)
  } finally {
    global.Environment = original
  }
})
