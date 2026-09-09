const { test } = require('sounding')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const run = promisify(require('node:child_process').execFile)
test('CLI readiness renders the server report unchanged and uses the selected environment and app', async ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-readiness-cli-'))
  const cli = path.resolve('packages/cli/src/index.js')
  const report = {
    version: 'server-version',
    sourceRevision: 'source-fingerprint',
    healthPath: '/ready',
    summary: { blocker: 0, warning: 1 },
    items: [
      {
        id: 'health',
        status: 'warning',
        category: 'health',
        title: 'Health',
        evidence: 'Not probed',
        fix: 'Serve /ready'
      }
    ],
    canDeploy: true
  }
  fs.mkdirSync(path.join(root, '.slipway'))
  fs.writeFileSync(
    path.join(root, '.slipway/config.json'),
    JSON.stringify({ token: 'fixture', server: 'https://fixture.invalid' })
  )
  fs.writeFileSync(
    path.join(root, '.slipway.json'),
    JSON.stringify({ project: 'ready-project' })
  )
  try {
    const runner = path.join(root, 'runner.mjs')
    fs.writeFileSync(
      runner,
      `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; import assert from 'node:assert/strict'; os.homedir = () => ${JSON.stringify(
        root
      )}; syncBuiltinESMExports(); process.chdir(${JSON.stringify(
        root
      )}); process.argv = ['node',${JSON.stringify(
        cli
      )},'readiness','--env','staging','--app','worker','--json']; globalThis.fetch = async (url, options) => { assert.equal(url, 'https://fixture.invalid/api/v1/projects/ready-project/environments/staging/readiness?app=worker'); assert.equal(options.method,'GET'); return new Response(JSON.stringify(${JSON.stringify(
        report
      )})); }; await import(${JSON.stringify(cli)});`
    )
    const result = await run(process.execPath, [runner])
    expect(JSON.parse(result.stdout)).toEqual(report)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
