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
        dependencies: { acorn: '8.18.0' },
        scripts: Object.fromEntries(
          ['postinstall', 'lint', 'test', 'build'].map((name) => [
            name,
            name === 'postinstall'
              ? 'node install.cjs'
              : `node isolation.cjs ${name}`
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
          packages: {
            '': {
              name: manifest.name,
              version: manifest.version,
              dependencies: manifest.dependencies
            },
            'node_modules/acorn': {
              version: '8.18.0',
              resolved: 'https://registry.npmjs.org/acorn/-/acorn-8.18.0.tgz',
              integrity:
                'sha512-lGq+9yr1/GuAWaVYIHRjvvySG5/4VfKIvC8EWxStPdcDh/Ka7FG3twP6v4d5BkravUilhIAsG4Qj83t02LWUPQ==',
              bin: { acorn: 'bin/acorn' },
              engines: { node: '>=0.4.0' }
            }
          }
        })
      )
      fs.writeFileSync(
        path.join(directory, 'install.cjs'),
        `const fs=require('fs');if(fs.existsSync('installed-once'))throw Error('reused workspace');fs.writeFileSync('installed-once','fresh');`
      )
      fs.writeFileSync(
        path.join(directory, 'isolation.cjs'),
        `const assert=require('node:assert/strict'),fs=require('node:fs');assert.equal(process.getuid(),1000);assert.equal(fs.readFileSync('installed-once','utf8'),'fresh');assert.ok(require('acorn').parse('1+1',{ecmaVersion:2020}));assert.equal(process.env.CI_PARENT_SECRET,undefined);assert.equal(fs.existsSync('/var/run/docker.sock'),false);assert.equal(fs.existsSync('/fixture'),false);assert.equal(fs.existsSync('/workspace/.git'),false);assert.match(fs.readFileSync('/proc/self/status','utf8'),/NoNewPrivs:[^0-9]*1/);assert.equal(fs.readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),'4294967296');assert.equal(fs.readFileSync('/sys/fs/cgroup/pids.max','utf8').trim(),'256');assert.deepEqual(Object.keys(require('node:os').networkInterfaces()),['lo']);assert.throws(()=>fs.writeFileSync('/ci-root-probe','x'));console.log(process.argv[2]+' isolation passed');`
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
      let commit = git('rev-parse', 'HEAD')
      for (const attempt of [
        ...(process.env.CI_SERVER_BASELINE ? ['baseline'] : []),
        'cold',
        'warm',
        'poison',
        'corrupt',
        'scope-change',
        'oversized',
        'expired',
        'ineligible'
      ]) {
        const attemptId = attempt === 'cold' ? id : crypto.randomUUID()
        if (attempt === 'ineligible') {
          const file = path.join(directory, 'package-lock.json')
          const lock = JSON.parse(fs.readFileSync(file))
          delete lock.packages['node_modules/acorn'].integrity
          fs.writeFileSync(file, JSON.stringify(lock))
          git('add', 'package-lock.json')
          git(
            '-c',
            'user.name=CI fixture',
            '-c',
            'user.email=ci@example.test',
            'commit',
            '-qm',
            'test(ci): unpinned fixture'
          )
          commit = git('rev-parse', 'HEAD')
        }
        const cacheDir = path.join(directory, 'cache')
        const cacheFile = fs.existsSync(cacheDir)
          ? fs.readdirSync(cacheDir).find((name) => name.endsWith('.tar'))
          : null
        if (cacheFile) {
          const file = path.join(cacheDir, cacheFile)
          if (attempt === 'poison') {
            const data = fs.readFileSync(file)
            const gzip = data.indexOf(Buffer.from([31, 139, 8]))
            assert.ok(gzip > 0)
            data[gzip + 12] ^= 255
            fs.writeFileSync(file, data)
          }
          if (attempt === 'corrupt') fs.writeFileSync(file, 'invalid tar')
          if (attempt === 'oversized') fs.truncateSync(file, 67108865)
          if (attempt === 'expired')
            fs.utimesSync(file, new Date(0), new Date(0))
        }
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
          // Linux runners own this bind mount as UID 1001; the parent is root.
          // Trust only this test-created repository, without changing production Git config.
          '--env',
          'GIT_CONFIG_COUNT=1',
          '--env',
          'GIT_CONFIG_KEY_0=safe.directory',
          '--env',
          'GIT_CONFIG_VALUE_0=/fixture',
          '-v',
          '/var/run/docker.sock:/var/run/docker.sock',
          '-v',
          directory + ':/fixture:ro',
          '-v',
          (attempt === 'baseline'
            ? process.env.CI_SERVER_BASELINE + '-contract.js'
            : path.join(root, 'api/lib/contracts/ci-contract.js')) +
            ':/app/api/lib/contracts/ci-contract.js:ro',
          '-v',
          directory + ':/evidence',
          '-v',
          (attempt === 'baseline'
            ? process.env.CI_SERVER_BASELINE + '-executor.cjs'
            : path.join(root, 'bin/ci-server-executor.cjs')) +
            ':/app/bin/ci-server-executor.cjs:ro',
          '--entrypoint',
          '/bin/sh',
          parentImage,
          '-c',
          // The executor parent is root; return only test-created cache ownership
          // to the runner so corruption fixtures and cleanup work on Linux too.
          `node /app/bin/ci-server-executor.cjs \"$@\"; result=$?; if [ -d /evidence/cache ]; then chown -R ${process.getuid()}:${process.getgid()} /evidence/cache; fi; exit \"$result\"`,
          'ci-proof',
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
          ...(attempt === 'baseline'
            ? []
            : [
                '--cache-dir',
                '/evidence/cache',
                '--cache-scope',
                (['scope-change', 'oversized', 'expired'].includes(attempt)
                  ? 'b'
                  : 'a'
                ).repeat(64)
              ]),
          '--run-id',
          attemptId
        )
        const exit = docker('wait', parent)
        const logs = docker('logs', parent)
        if (exit !== '0') {
          try {
            docker(
              'cp',
              parent + ':/tmp/ci-proof',
              path.join(directory, 'failure')
            )
          } catch {
            assert.fail(logs || 'Executor stopped before creating its report.')
          }
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
        fs.writeFileSync(
          path.join(directory, attempt + '.json'),
          JSON.stringify(report, null, 2)
        )
        if (process.env.CI_SERVER_EVIDENCE) {
          fs.mkdirSync(process.env.CI_SERVER_EVIDENCE, { recursive: true })
          fs.copyFileSync(
            path.join(directory, attempt + '.json'),
            path.join(process.env.CI_SERVER_EVIDENCE, attempt + '.json')
          )
        }
        if (attempt === 'ineligible')
          assert.equal(report.cache.state, 'ineligible-lockfile')
        if (!['baseline', 'ineligible'].includes(attempt)) {
          assert.equal(
            report.cache.state,
            ['warm', 'poison'].includes(attempt)
              ? 'hit'
              : attempt === 'corrupt'
              ? 'invalid-archive'
              : 'miss'
          )
          assert.equal(fs.readdirSync(cacheDir).length, 1)
          assert.ok((report.cache.savedBytes || report.cache.restoredBytes) > 0)
          assert.ok(
            (report.cache.savedBytes || report.cache.restoredBytes) <= 67108864
          )
          assert.ok(
            report.steps.every(
              (step) => step.resources.mounts['/tmp'].availableBytes > 0
            )
          )
          assert.ok(
            report.steps.every((step) => step.resources.stepCpuSeconds >= 0)
          )
        }
        assert.equal(report.state, 'passed')
        assert.equal(report.sourceRevision, commit)
        assert.equal(report.checkNetwork, 'disconnected')
        assert.equal(report.cleanup.state, 'completed')
        assert.equal(report.deployable, false)
        assert.deepEqual(
          report.steps.map((step) => [step.name, step.state]),
          ['install', 'lint', 'test', 'build'].map((name) => [name, 'passed'])
        )
        assert.throws(() =>
          docker('container', 'inspect', 'slipway-ci-server-' + attemptId)
        )
        docker('rm', '-f', parent)
      }
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
