const { test } = require('sounding')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs')
const { spawnSync } = require('node:child_process')
const dashboard = require('../../../../api/lib/contracts/ci-contract')
const cli = require('../../../../packages/cli/src/lib/ci-contract.cjs')

test('independent dashboard and CLI CI contracts bind the same reviewed executor without package imports', () => {
  const manifest = {
    scripts: {
      lint: 'prettier --check .',
      test: 'node --test',
      build: 'node build.js'
    }
  }
  for (const platform of ['linux/amd64', 'linux/arm64'])
    assert.deepEqual(
      dashboard.configuration(
        manifest,
        'node@sha256:' + 'a'.repeat(64),
        platform
      ),
      cli.configuration(manifest, 'node@sha256:' + 'a'.repeat(64), platform)
    )
  assert.equal(dashboard.executorDigest(), cli.executorDigest())
  const challenge = { nonce: 'test', appId: '1', policyRevision: 'revision' },
    report = { state: 'passed', deployable: false, steps: [] }
  assert.deepEqual(
    dashboard.statement(challenge, report),
    cli.statement(challenge, report)
  )
  assert.equal(
    dashboard.canonical({ z: [1, null, true], a: { key: 'value' } }),
    cli.canonical({ z: [1, null, true], a: { key: 'value' } })
  )
  const root = path.resolve(__dirname, '../../../..')
  const helperFiles = fs
    .readdirSync(path.join(root, 'api/helpers/ci'))
    .filter((file) => file.endsWith('.js'))
  const script = `const M=require('node:module'),load=M._load;M._load=function(id,...args){if(id.includes('packages/'))throw new Error('Independent packages are absent from production');return load.call(this,id,...args)};for(const file of ${JSON.stringify(
    helperFiles
  )})require('./api/helpers/ci/'+file);require('./api/lib/contracts/ci-contract').configuration(${JSON.stringify(
    manifest
  )},'node@sha256:'+'a'.repeat(64),'linux/amd64');`
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8'
  })
  assert.equal(result.status, 0, result.stderr)
})
