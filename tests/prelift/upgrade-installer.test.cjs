const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const image = `ghcr.io/sailscastshq/slipway@sha256:${'a'.repeat(64)}`
function fixture({ existing = true, digest = image, bundle = true }, run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'upgrade-installer-'))
  const bin = path.join(root, 'bin'),
    envFile = path.join(root, 'existing.env'),
    calls = path.join(root, 'calls.jsonl'),
    hostCall = path.join(root, 'host-call.txt')
  fs.mkdirSync(bin)
  const contents =
    'SESSION_SECRET=synthetic-existing-session-secret\nDATA_ENCRYPTION_KEY=synthetic-existing-encryption-key\nSLIPWAY_SETUP_TOKEN=synthetic-existing-install-claim\n'
  fs.writeFileSync(envFile, contents, { mode: 0o600 })
  const docker = `#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);fs.appendFileSync(process.env.FIXTURE_CALLS,JSON.stringify(a)+'\\n');
if(a[0]==='container'&&a[1]==='inspect')process.exit(process.env.FIXTURE_EXISTING==='yes'?0:1);
if(a[0]==='image'&&a[1]==='inspect')process.stdout.write(process.env.FIXTURE_DIGEST+'\\n');
else if(a[0]==='run'&&a.includes('--entrypoint')&&a[a.indexOf('--entrypoint')+1]==='node')process.stdout.write('yes\\n');
else if(a[0]==='run'&&a.includes('--entrypoint')&&a[a.indexOf('--entrypoint')+1]==='cat')process.stdout.write(fs.readFileSync(process.env.FIXTURE_HOST_SCRIPT,'utf8'));
`
  const hostScript = path.join(root, 'fixture-host.sh')
  fs.writeFileSync(
    hostScript,
    '#!/bin/bash\nprintf \'%s\\n\' "$@" > "$FIXTURE_HOST_CALL"\n'
  )
  fs.writeFileSync(calls, '')
  fs.writeFileSync(path.join(bin, 'docker'), docker, { mode: 0o700 })
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/bash\nprintf 127.0.0.1\n', {
    mode: 0o700
  })
  const bundleFile = path.join(root, 'host.tar.gz')
  fs.writeFileSync(bundleFile, 'synthetic fixture archive')
  const environment = {
    ...process.env,
    PATH: bin + path.delimiter + process.env.PATH,
    FIXTURE_CALLS: calls,
    FIXTURE_HOST_CALL: hostCall,
    FIXTURE_HOST_SCRIPT: hostScript,
    FIXTURE_EXISTING: existing ? 'yes' : 'no',
    FIXTURE_DIGEST: digest,
    SLIPWAY_HOST_BUNDLE: bundle ? bundleFile : '',
    SLIPWAY_HOST_BUNDLE_SHA256: bundle ? 'b'.repeat(64) : '',
    SLIPWAY_ENV_FILE: envFile,
    SLIPWAY_UPGRADE_STATE_DIR: path.join(root, 'state'),
    SLIPWAY_APPS_DIR: path.join(root, 'apps'),
    SLIPWAY_CONFIGURE_FIREWALL: 'false',
    SLIPWAY_URL: 'http://127.0.0.1',
    SLIPWAY_CONTAINER: 'fixture-slipway'
  }
  try {
    const result = spawnSync('bash', ['install.sh', '0.0.88'], {
      cwd: path.resolve(__dirname, '../..'),
      env: environment,
      encoding: 'utf8',
      timeout: 20000
    })
    run({
      result,
      root,
      hostCall,
      calls: fs
        .readFileSync(calls, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
      contents: fs.readFileSync(envFile, 'utf8'),
      original: contents
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}
test('existing coordinated installer returns a review command before changing proxy, config or live app', () =>
  fixture({}, ({ result, calls, contents, original }) => {
    assert.equal(result.status, 2, result.stderr)
    assert.ok(result.stdout.includes(' plan --bundle '))
    assert.ok(result.stdout.includes('--image ' + image))
    assert.equal(contents, original)
    assert.ok(
      !calls.some((a) =>
        ['rm', 'create', 'start', 'stop', 'rename', 'network', 'exec'].includes(
          a[0]
        )
      )
    )
    assert.ok(
      calls
        .filter((a) => a[0] === 'run')
        .every(
          (a) =>
            a.includes('--rm') && a.includes('--network') && !a.includes('-v')
        )
    )
    assert.ok(!JSON.stringify(calls).includes('synthetic-existing'))
  }))
test('fresh installer creates an unstarted labeled template and dispatches exact initialization without shared-data validation', () =>
  fixture({ existing: false }, ({ result, calls, hostCall }) => {
    assert.equal(result.status, 0, result.stderr)
    const created = calls.find((a) => a[0] === 'create')
    assert.ok(created.includes('io.slipway.install.pending=true'))
    assert.ok(created.includes('--env-file'))
    assert.equal(created.at(-1), image)
    assert.ok(!created.includes('-d'))
    assert.ok(
      !calls.some(
        (a) => a[0] === 'run' && a.at(-1) === image && a.includes('-v')
      )
    )
    assert.ok(
      !JSON.stringify(calls).includes('synthetic-existing-session-secret')
    )
    assert.ok(
      !JSON.stringify(calls).includes('synthetic-existing-encryption-key')
    )
    assert.deepEqual(fs.readFileSync(hostCall, 'utf8').trim().split('\n'), [
      'initialize',
      '--bundle',
      path.dirname(hostCall) + '/host.tar.gz',
      '--bundle-sha256',
      'b'.repeat(64),
      '--image',
      image,
      '--container',
      'fixture-slipway',
      '--state-dir',
      path.dirname(hostCall) + '/state'
    ])
  }))
test('nonofficial digest fails before any installer config or proxy mutation', () =>
  fixture(
    { digest: `localhost/fixture@sha256:${'a'.repeat(64)}` },
    ({ result, calls, contents, original }) => {
      assert.equal(result.status, 2)
      assert.equal(contents, original)
      assert.ok(
        !calls.some((a) =>
          [
            'rm',
            'create',
            'start',
            'stop',
            'rename',
            'network',
            'exec'
          ].includes(a[0])
        )
      )
    }
  ))

test('fresh installer with no verified host bundle stops before network or proxy changes', () =>
  fixture(
    { existing: false, bundle: false },
    ({ result, calls, contents, original }) => {
      assert.equal(result.status, 2)
      assert.equal(contents, original)
      assert.ok(
        !calls.some((a) =>
          ['network', 'create', 'start', 'stop', 'rm'].includes(a[0])
        )
      )
      assert.match(result.stderr, /SLIPWAY_HOST_BUNDLE/)
    }
  ))
