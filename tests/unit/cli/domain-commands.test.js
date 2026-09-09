const { test } = require('sounding')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const run = promisify(execFile)

test('documented domain commands send the environment hostname and empty removal value', async ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-domain-cli-'))
  const cli = path.resolve('packages/cli/src/index.js')
  fs.mkdirSync(path.join(root, '.slipway'), { mode: 0o700 })
  fs.writeFileSync(
    path.join(root, '.slipway/config.json'),
    JSON.stringify({
      token: 'fixture-token',
      server: 'https://fixture.invalid'
    }),
    { mode: 0o600 }
  )
  fs.writeFileSync(
    path.join(root, '.slipway.json'),
    JSON.stringify({ project: 'fixture-project' })
  )
  try {
    for (const domain of ['app.example.com', '']) {
      const script = `
        import os from 'node:os';
        import { syncBuiltinESMExports } from 'node:module';
        import assert from 'node:assert/strict';
        os.homedir = () => ${JSON.stringify(root)};
        syncBuiltinESMExports();
        process.chdir(${JSON.stringify(root)});
        process.argv = ['node', ${JSON.stringify(
          cli
        )}, 'environment:update', 'production', '--domain', ${JSON.stringify(
        domain
      )}];
        globalThis.fetch = async (url, options) => {
          assert.equal(url, 'https://fixture.invalid/api/v1/projects/fixture-project/environments/production');
          assert.equal(options.method, 'PATCH');
          assert.equal(JSON.parse(options.body).domain, ${JSON.stringify(
            domain
          )});
          return new Response(JSON.stringify({ environment: { name: 'Production', slug: 'production', domain: ${JSON.stringify(
            domain
          )} }, domainReadiness: { dnsTarget: '203.0.113.10', route: 'verified', nextAction: 'Open the HTTPS URL to verify certificate issuance.' } }));
        };
        await import(${JSON.stringify(cli)});
      `
      const runner = path.join(root, 'run.mjs')
      fs.writeFileSync(runner, script)
      const result = await run(process.execPath, [runner])
      expect(result.stdout).toContain('Verified at save')
      expect(result.stdout).toContain('Not verified')
      expect(result.stdout).toContain('203.0.113.10')
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('documentation consistency rejects invented CLI commands', async ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-command-docs-'))
  const file = path.join(root, 'guide.md')
  fs.writeFileSync(file, '```bash\nslipway domain:add app example.com\n```\n')
  try {
    let failure
    try {
      await run(process.execPath, [
        'scripts/check-docs-config-consistency.js',
        file
      ])
    } catch (error) {
      failure = error
    }
    expect(failure.code).toBe(1)
    expect(failure.stderr).toContain('unknown CLI command: domain:add')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
