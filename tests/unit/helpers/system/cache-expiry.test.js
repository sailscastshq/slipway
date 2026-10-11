const { test } = require('sounding')
const assert = require('node:assert/strict')

test('container state expires after 30 seconds and fresh reads bypass it', async ({
  sails
}) => {
  // Lift the isolated app before advancing its cache clock.
  await sails.cache.get('expiry-fixture-initialize')
  const originalNow = Date.now
  let now = originalNow()
  let inspections = 0
  const execFile = () => {}
  execFile[require('node:util').promisify.custom] = async () => {
    inspections++
    return { stdout: JSON.stringify({ Running: true, Status: 'running' }) }
  }
  const loaded = { exports: {} }
  require('node:vm').runInNewContext(
    require('node:fs').readFileSync(
      require.resolve('../../../../api/helpers/docker/get-container-status'),
      'utf8'
    ),
    {
      module: loaded,
      sails,
      require: (name) =>
        name === 'child_process' ? { execFile } : require(name)
    }
  )
  const helper = loaded.exports
  Date.now = () => now
  try {
    const read = (fresh = false) =>
      helper.fn({ containerName: 'expiry-fixture', fresh })
    await sails.cache.set(
      'container:status:expiry-fixture',
      { running: false },
      30000
    )
    assert.equal((await read()).running, true)
    now += 29999
    await read()
    assert.equal(inspections, 1)
    now++
    await read()
    assert.equal(inspections, 2)
    await read(true)
    assert.equal(inspections, 3)
  } finally {
    Date.now = originalNow
  }
})

test('cached update checks, GitHub data and settings expire at their intended seconds', async ({
  sails
}) => {
  const originalFetch = global.fetch
  const originalNow = Date.now
  const originalNotifications = sails.config.slipway.showUpdateNotifications
  let now = originalNow()
  let requests = 0
  Date.now = () => now
  sails.config.slipway.showUpdateNotifications = true
  global.fetch = async (url) => {
    requests++
    if (url.includes('/releases/latest')) {
      return Response.json({ tag_name: `v${sails.config.slipway.version}` })
    }
    return Response.json([])
  }
  const cases = [
    [3600, () => sails.helpers.system.checkForUpdates()],
    [300, () => sails.helpers.git.listGithubRepos('expiry-fixture-token')],
    [
      120,
      () =>
        sails.helpers.git.listGithubBranches(
          'expiry-fixture-token',
          'fixture',
          'repo'
        )
    ]
  ]
  try {
    // Legacy persisted values must not keep the former 1,000x TTL after upgrade.
    await sails.cache.set(
      'slipway_update_check',
      { latestVersion: 'legacy' },
      3600000
    )
    for (const [seconds, read] of cases) {
      const before = requests
      await read()
      assert.equal(requests, before + 1)
      now += seconds * 1000 - 1
      await read()
      assert.equal(requests, before + 1)
      now++
      await read()
      assert.equal(requests, before + 2)
    }

    const key = 'cacheExpiryFixture'
    await Setting.create({ key, value: 'first' })
    assert.equal(await sails.helpers.setting.get(key), 'first')
    await Setting.updateOne({ key }).set({ value: 'second' })
    now += 900000 - 1
    assert.equal(await sails.helpers.setting.get(key), 'first')
    now++
    assert.equal(await sails.helpers.setting.get(key), 'second')
    await sails.helpers.setting.set(key, 'third')
    assert.equal(await sails.helpers.setting.get(key), 'third')

    assert.equal(
      await sails.helpers.setting.get('cacheExpiryMissing', 'fallback'),
      'fallback'
    )
    await Setting.create({ key: 'cacheExpiryMissing', value: 'created' })
    assert.equal(
      await sails.helpers.setting.get('cacheExpiryMissing', 'fallback'),
      'fallback'
    )
    now += 900000
    assert.equal(
      await sails.helpers.setting.get('cacheExpiryMissing', 'fallback'),
      'created'
    )
  } finally {
    Date.now = originalNow
    global.fetch = originalFetch
    sails.config.slipway.showUpdateNotifications = originalNotifications
  }
})
