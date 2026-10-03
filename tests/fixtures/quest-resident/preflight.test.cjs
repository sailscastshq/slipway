const assert = require('node:assert/strict')
const path = require('node:path')
const { test } = require('node:test')
const { createFixture, upstreamSource } = require('./docker.cjs')

test('missing upstream source fails before any Docker activity', async () => {
  await assert.rejects(
    createFixture({ id: 1, currentDeployment: 1 }, { env: {} }),
    /SLIPWAY_QUEST_UPSTREAM_ROOT/
  )
})
test('another package cannot substitute for real upstream Quest', async () => {
  await assert.rejects(
    upstreamSource({ SLIPWAY_QUEST_UPSTREAM_ROOT: path.resolve('.') }),
    /Actual upstream Quest package required/
  )
})
test('an absent source directory is an error rather than a skipped integration', async () => {
  await assert.rejects(
    upstreamSource({
      SLIPWAY_QUEST_UPSTREAM_ROOT: path.join(__dirname, 'absent-upstream')
    }),
    { code: 'ENOENT' }
  )
})
test('a supplied source still requires an asserted full commit SHA', async () => {
  await assert.rejects(
    upstreamSource({
      SLIPWAY_QUEST_UPSTREAM_ROOT: path.dirname(
        require.resolve('sails-hook-quest/package.json')
      ),
      SLIPWAY_QUEST_UPSTREAM_SHA: 'main'
    }),
    /verified full commit SHA/
  )
})
test('the known unsafe superseded scheduler source is explicitly rejected', async () => {
  await assert.rejects(
    upstreamSource({
      SLIPWAY_QUEST_UPSTREAM_ROOT: path.dirname(
        require.resolve('sails-hook-quest/package.json')
      ),
      SLIPWAY_QUEST_UPSTREAM_SHA: '788d767132dab969a6602bdb9d718c17a8ce8a7c'
    }),
    /Unsafe superseded/
  )
})
