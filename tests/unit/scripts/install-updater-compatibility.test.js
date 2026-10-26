const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function fixture(version, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'installer-capability-'))
  const bin = path.join(root, 'bin')
  fs.mkdirSync(bin)
  const stateFile = path.join(root, 'state.json')
  const eventsFile = path.join(root, 'events.jsonl')
  const identities = {
    slipway: 'existing-management',
    proxy: 'existing-proxy',
    app: 'existing-app'
  }
  const state = {
    version,
    engine: true,
    exports: true,
    imageId: 'sha256:verified-target',
    identities,
    ...overrides
  }
  fs.writeFileSync(stateFile, JSON.stringify(state))
  const fake = `#!${process.execPath}
const fs=require('node:fs'),vm=require('node:vm');const args=process.argv.slice(2),file=process.env.PROBE_STATE;
let state=JSON.parse(fs.readFileSync(file,'utf8'));
fs.appendFileSync(process.env.PROBE_EVENTS,JSON.stringify(args)+'\\n');
if(args[0]==='container'&&args[1]==='inspect')process.exit(0);
if(args[0]==='pull')process.exit(0);
if(args[0]==='image'&&args[1]==='inspect'){console.log(state.imageId);process.exit(0)}
if(args[0]==='run'&&args.includes('--read-only')){
  if(args.includes('-v')||args.includes('--mount')||!args.includes('none'))throw Error('Probe exposed host access');
  const mock={argv:[process.execPath,args.at(-1)],exitCode:0};
  vm.runInNewContext(args[args.indexOf('-e')+1],{process:mock,console,require(name){
    if(name==='/app/package.json')return {version:state.version};
    if(name==='fs')return {existsSync(){return state.engine}};
    if(name==='/app/bin/slipway-updater.cjs')return state.exports?{main(){throw Error('Probe must not execute updater')},createUpdater(){throw Error('Probe must not admit updater')},PREFIX:'SLIPWAY_UPDATE '}:{main:42};
    throw Error('Unexpected probe import '+name)
  }});
  if(!mock.exitCode&&state.moveTag){state.imageId='sha256:changed-tag';fs.writeFileSync(file,JSON.stringify(state))}
  process.exit(mock.exitCode);
}
if(args[0]==='run'&&args.includes('/app/bin/slipway-updater.cjs')){
  if(!args.includes('sha256:verified-target'))throw Error('Bootstrap did not use verified immutable image');
  if(args.includes('start')){
    if(args[args.indexOf('--image')+1]!=='sha256:verified-target')throw Error('Mutable target reused');
    if(args[args.indexOf('--skip-pull')+1]!=='true')throw Error('Verified image would be pulled again');
  }
  console.log(JSON.stringify({phase:'success'}));process.exit(0)
}
throw Error('Forbidden installation action '+JSON.stringify(args));
`
  fs.writeFileSync(path.join(bin, 'docker'), fake, { mode: 0o755 })
  for (const name of [
    'curl',
    'systemctl',
    'sudo',
    'apt-get',
    'ufw',
    'firewall-cmd',
    'openssl',
    'mkdir',
    'install'
  ])
    fs.writeFileSync(
      path.join(bin, name),
      `#!${
        process.execPath
      }\nrequire('fs').appendFileSync(process.env.PROBE_EVENTS,JSON.stringify(['forbidden-host-command',${JSON.stringify(
        name
      )}])+'\\n');process.exit(99)\n`,
      { mode: 0o755 }
    )
  const result = spawnSync(
    'bash',
    [path.resolve(__dirname, '../../../install.sh'), version],
    {
      encoding: 'utf8',
      timeout: 10000,
      env: {
        ...process.env,
        PATH: bin + path.delimiter + process.env.PATH,
        PROBE_STATE: stateFile,
        PROBE_EVENTS: eventsFile,
        SLIPWAY_VERSION: version,
        SLIPWAY_CONTAINER: 'slipway',
        SLIPWAY_IMAGE_REPOSITORY: 'fixture/slipway',
        SLIPWAY_ENV_FILE: path.join(root, 'must-not-create'),
        SLIPWAY_SKIP_PULL: 'false'
      }
    }
  )
  const events = fs
    .readFileSync(eventsFile, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
  return {
    result,
    events,
    state: JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    identities,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true })
  }
}

for (const scenario of [
  { name: 'published older release', version: '0.0.121', engine: false },
  { name: 'missing runner', version: '0.0.122', engine: false },
  { name: 'mismatched image metadata', version: '0.0.122', actual: '0.0.123' },
  { name: 'malformed image metadata', version: '0.0.122', actual: 'invalid' },
  { name: 'unsupported runner exports', version: '0.0.122', exports: false }
])
  test(`installer rejects ${scenario.name} before updater admission or host setup`, () => {
    const f = fixture(scenario.version, {
      ...scenario,
      version: scenario.actual || scenario.version
    })
    try {
      assert.notEqual(f.result.status, 0)
      assert.match(f.result.stderr, /No updater operation was started/)
      assert.match(f.result.stderr, /matching version-pinned install.sh/)
      assert.equal(
        f.events.some(
          (args) =>
            args.includes('start') ||
            args.includes('watch') ||
            args.includes('/var/run/docker.sock:/var/run/docker.sock')
        ),
        false
      )
      assert.equal(
        f.events.some((args) => args[0] === 'forbidden-host-command'),
        false
      )
      assert.deepEqual(f.state.identities, f.identities)
    } finally {
      f.cleanup()
    }
  })

test('compatible image is probed without host access and both commands use its verified ID even if its tag moves', () => {
  const f = fixture('0.0.122', { moveTag: true })
  try {
    assert.equal(f.result.status, 0, f.result.stderr)
    const probe = f.events.findIndex((args) => args.includes('--read-only'))
    const start = f.events.findIndex((args) => args.includes('start'))
    assert.ok(probe >= 0 && probe < start)
    assert.equal(f.events.filter((args) => args[0] === 'pull').length, 1)
    assert.equal(f.events.filter((args) => args.includes('start')).length, 1)
    assert.equal(f.events.filter((args) => args.includes('watch')).length, 1)
    assert.equal(
      f.events.some((args) => args[0] === 'forbidden-host-command'),
      false
    )
    assert.deepEqual(f.state.identities, f.identities)
  } finally {
    f.cleanup()
  }
})

test('the latest alias still requires a compatible packaged engine', () => {
  const f = fixture('latest', { version: '0.0.122' })
  try {
    assert.equal(f.result.status, 0, f.result.stderr)
    assert.equal(f.events.filter((args) => args.includes('start')).length, 1)
  } finally {
    f.cleanup()
  }
})
