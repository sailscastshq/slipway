const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const parentImage =
  'ghcr.io/sailscastshq/slipway@sha256:1e4471b9169d03859ea179775237ffe590cefd5e190f8b6ab224f50a034d83c0'
const runtime =
  'node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09'
test(
  'real server CI runs exact source without host mounts, credentials or check egress and removes only its owned container',
  { skip: process.env.CI_SERVER_DOCKER !== '1', timeout: 600000 },
  () => {
    const root = path.resolve(__dirname, '../..'),
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-server-proof-'))
    const id = crypto.randomUUID(),
      parent = 'ci-server-parent-' + id,
      child = 'slipway-ci-server-' + id
    const docker = (...args) =>
      execFileSync('docker', args, {
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 1024 * 1024
      }).trim()
    try {
      const manifest = {
        name: 'ci-isolation-proof',
        version: '1.0.0',
        scripts: Object.fromEntries(
          ['lint', 'test', 'build'].map((name) => [
            name,
            `node isolation.cjs ${name}`
          ])
        )
      }
      fs.writeFileSync(
        path.join(directory, 'package.json'),
        JSON.stringify(manifest)
      )
      fs.writeFileSync(
        path.join(directory, 'package-lock.json'),
        JSON.stringify({
          name: manifest.name,
          version: manifest.version,
          lockfileVersion: 3,
          packages: { '': { name: manifest.name, version: manifest.version } }
        })
      )
      fs.writeFileSync(
        path.join(directory, 'isolation.cjs'),
        `const assert=require('node:assert/strict'),fs=require('node:fs');assert.equal(process.getuid(),1000);assert.equal(process.env.CI_PARENT_SECRET,undefined);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.equal(fs.existsSync('/fixture'),false);assert.equal(fs.existsSync('/workspace/.git'),false);assert.match(fs.readFileSync('/proc/self/status','utf8'),/NoNewPrivs:[^0-9]*1/);assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'4294967296');assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'256');assert.deepEqual(Object.keys(require('node:os').networkInterfaces()),['lo']);assert.throws(()=>fs.writeFileSync('/ci-root-probe','x'));console.log(process.argv[2]+' isolation passed');`
      )
      const git = (...args) =>
        execFileSync('git', ['-C', directory, ...args], {
          encoding: 'utf8'
        }).trim()
      git('init', '-q')
      git('add', '.')
      git(
        '-c',
        'user.name=CI fixture',
        '-c',
        'user.email=ci@example.test',
        'commit',
        '-qm',
        'test(ci): verify server isolation'
      )
      const commit = git('rev-parse', 'HEAD')
      docker(
        'run',
        '-d',
        '--name',
        parent,
        '--platform',
        'linux/amd64',
        '--network',
        'none',
        '--env',
        'CI_PARENT_SECRET=must-not-reach-job',
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock',
        '-v',
        directory + ':/fixture:ro',
        '-v',
        path.join(root, 'bin/ci-server-executor.cjs') +
          ':/app/bin/ci-server-executor.cjs:ro',
        '--entrypoint',
        'node',
        parentImage,
        '/app/bin/ci-server-executor.cjs',
        '--repo',
        '/fixture',
        '--commit',
        commit,
        '--image',
        runtime,
        '--platform',
        'linux/amd64',
        '--approve',
        'lint,test,build',
        '--approve-install',
        'yes',
        '--out',
        '/tmp/ci-proof',
        '--run-id',
        id
      )
      const exit = docker('wait', parent)
      const logs = docker('logs', parent)
      if (exit !== '0') {
        docker('cp', parent + ':/tmp/ci-proof', path.join(directory, 'failure'))
        const details = fs
          .readdirSync(path.join(directory, 'failure'))
          .filter((name) => name.endsWith('.log') || name === 'report.json')
          .map(
            (name) =>
              name +
              ': ' +
              fs
                .readFileSync(path.join(directory, 'failure', name), 'utf8')
                .slice(-6000)
          )
          .join('\n')
        assert.fail(logs + '\n' + details)
      }
      docker(
        'cp',
        parent + ':/tmp/ci-proof/report.json',
        path.join(directory, 'report.json')
      )
      const report = JSON.parse(
        fs.readFileSync(path.join(directory, 'report.json'), 'utf8')
      )
      assert.equal(report.state, 'passed')
      assert.equal(report.sourceRevision, commit)
      assert.equal(report.checkNetwork, 'disconnected')
      assert.equal(report.cleanup.state, 'completed')
      assert.equal(report.deployable, false)
      assert.deepEqual(
        report.steps.map((step) => [step.name, step.state]),
        ['install', 'lint', 'test', 'build'].map((name) => [name, 'passed'])
      )
      assert.throws(() => docker('container', 'inspect', child))
    } finally {
      for (const name of [parent, child]) {
        try {
          docker('rm', '-f', name)
        } catch {}
      }
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
