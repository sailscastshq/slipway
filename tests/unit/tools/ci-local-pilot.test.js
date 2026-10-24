const { test } = require('sounding')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-pilot-test-'))
  const repo = path.join(root, 'repo'),
    bin = path.join(root, 'bin')
  fs.mkdirSync(repo)
  fs.mkdirSync(bin)
  const git = (args) =>
    execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repo, ...args], {
      stdio: 'pipe'
    })
      .toString()
      .trim()
  git(['init', '-b', 'feat/fixture'])
  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      scripts: {
        lint: 'echo lint',
        test: 'must not execute on host',
        build: 'must not execute on host'
      }
    })
  )
  fs.writeFileSync(
    path.join(repo, 'package-lock.json'),
    JSON.stringify({ version: '1.0.0', packages: { '': { version: '1.0.0' } } })
  )
  git(['add', '.'])
  git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '-m',
    'test: fixture'
  ])
  const commit = git(['rev-parse', 'HEAD'])
  const log = path.join(root, 'docker-calls.jsonl')
  const docker = path.join(bin, 'docker')
  fs.writeFileSync(
    docker,
    `#!${process.execPath}\nconst fs=require('fs');const a=process.argv.slice(2);fs.appendFileSync(process.env.CI_TEST_LOG,JSON.stringify(a)+'\\n');const out=x=>console.log(JSON.stringify(x));
if(a[0]==='context')out(process.env.CI_TEST_REMOTE==='yes'?'ssh://production.example.test':'unix:///local-desktop.sock');
else if(a[0]==='info')out({OperatingSystem:'Docker Desktop',MemTotal:8*1024**3});
else if(a[0]==='image')out({Os:'linux',Architecture:'amd64',Id:'sha256:'+'a'.repeat(64),Size:100});
else if(a[0]==='inspect'&&a.includes('{{.Image}}'))console.log('sha256:'+'a'.repeat(64));
else if(a[0]==='run')console.log('fixture-container');
else if(a[0]==='exec'&&a.includes('tar'))process.stdin.resume();
else if(a[0]==='exec'&&a.includes('--version'))console.log(a.includes('npm')?'10.9.4':'v22.23.3');
else if(a[0]==='exec'&&a.includes('ci')){console.log('intentional install failure');process.exitCode=1;}
else if(a[0]==='exec'&&a.includes('-e'))out({cpu:'usage_usec 1200000',memoryPeak:'123456'});
else if(a[0]==='rm')console.log('removed');
else {console.error('Unexpected fake Docker call');process.exitCode=125;}
`,
    { mode: 0o755 }
  )
  return { root, repo, commit, bin, log, git }
}
function run(f, extraEnv = {}) {
  return spawnSync(
    process.execPath,
    [
      path.resolve('tools/ci-local-pilot.cjs'),
      '--repo',
      f.repo,
      '--commit',
      f.commit,
      '--image',
      'node@sha256:' + 'a'.repeat(64),
      '--platform',
      'linux/amd64',
      '--approve',
      'lint,test,build',
      '--approve-install',
      'yes',
      '--out',
      path.join(f.root, 'evidence')
    ],
    {
      env: {
        ...process.env,
        DOCKER_HOST: '',
        PATH: f.bin + path.delimiter + process.env.PATH,
        CI_TEST_LOG: f.log,
        ...extraEnv
      },
      encoding: 'utf8',
      timeout: 30000
    }
  )
}

test('local Slipway CI pilot refuses a remote Docker context before starting any job', async () => {
  const f = fixture()
  try {
    const result = run(f, { CI_TEST_REMOTE: 'yes' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /requires Docker Desktop/)
    const calls = fs
      .readFileSync(f.log, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
    assert.equal(
      calls.some((args) => args[0] === 'run' || args[0] === 'exec'),
      false
    )
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})

test('local Slipway CI pilot rejects tracked databases before contacting Docker', async () => {
  const f = fixture()
  try {
    fs.writeFileSync(path.join(f.repo, 'production.db'), 'not a real database')
    f.git(['add', '.'])
    f.git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'test: runtime-file fixture'
    ])
    f.commit = f.git(['rev-parse', 'HEAD'])
    const result = run(f)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Tracked runtime or environment files/)
    assert.equal(fs.existsSync(f.log), false)
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})

test('local Slipway CI pilot records setup failure, prevents deployment and cleans only its own container', async () => {
  const f = fixture()
  try {
    const result = run(f)
    assert.equal(result.status, 1, result.stderr)
    const report = JSON.parse(
      fs.readFileSync(path.join(f.root, 'evidence/report.json'))
    )
    assert.equal(report.state, 'failed')
    assert.equal(report.failureClass, 'setup-failed')
    assert.equal(report.deployable, false)
    assert.equal(
      report.lockDigest,
      'sha256:' +
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(f.repo, 'package-lock.json')))
          .digest('hex')
    )
    assert.equal(report.cleanup.state, 'completed')
    assert.equal(report.steps.length, 1)
    assert.equal(report.steps[0].name, 'install')
    const calls = fs
      .readFileSync(f.log, 'utf8')
      .trim()
      .split('\n')
      .map(JSON.parse)
    const create = calls.find((args) => args[0] === 'run')
    assert.equal(create.includes('--privileged'), false)
    assert.equal(
      create.some(
        (arg) => arg.includes('docker.sock') || arg.startsWith('/var/slipway')
      ),
      false
    )
    assert.equal(create[create.indexOf('--user') + 1], '1000:1000')
    assert.equal(create.includes('--read-only'), true)
    assert.equal(
      create.some((arg) => arg.startsWith('/workspace:rw,exec,')),
      true
    )
    const removed = calls.find((args) => args[0] === 'rm')
    assert.equal(removed[2], report.cleanup.container)
    assert.match(removed[2], /^slipway-ci-local-/)
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true })
  }
})
