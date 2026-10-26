const { test } = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const parent =
  'ghcr.io/sailscastshq/slipway@sha256:1e4471b9169d03859ea179775237ffe590cefd5e190f8b6ab224f50a034d83c0'
test(
  'the host installer and detached engine update a disposable instance with real SQLite copies, receipts and preserved configuration',
  { skip: process.env.SLIPWAY_UPDATER_DOCKER !== '1', timeout: 600000 },
  async () => {
    const targetVersion = require('../../package.json').version
    const nextParts = targetVersion.split('.').map(Number)
    nextParts[2]++
    const nextVersion = nextParts.join('.')
    const id = crypto.randomUUID().slice(0, 8),
      name = 'updater-proof-' + id,
      network = name + '-network',
      volume = name + '-db',
      apps = name + '-apps',
      repository = 'updater-proof-image-' + id,
      target = repository + ':' + targetVersion,
      old = repository + ':old',
      broken = repository + ':' + nextVersion,
      witness = name + '-witness'
    const root = path.resolve(__dirname, '../..')
    const docker = (...args) =>
      execFileSync('docker', args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 300000,
        maxBuffer: 2 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe']
      }).trim()
    const inspect = (n) => JSON.parse(docker('inspect', n))[0]
    const pause = (ms) => new Promise((r) => setTimeout(r, ms))
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-859-real-proof-')
    )
    try {
      execFileSync(
        'docker',
        ['build', '--platform', 'linux/amd64', '-t', target, '-f', '-', '.'],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 300000,
          maxBuffer: 4 * 1024 * 1024,
          input: `FROM ${parent}\nCOPY . /app\nRUN node -e "require('fs').writeFileSync('/updater-proof-server.cjs',Buffer.from('${fs
            .readFileSync(
              path.join(root, 'tests/fixtures/shared-updater/server.cjs')
            )
            .toString(
              'base64'
            )}','base64'))"\nCMD ["node","/updater-proof-server.cjs"]\n`
        }
      )
      execFileSync(
        'docker',
        ['build', '--platform', 'linux/amd64', '-t', old, '-f', '-', '.'],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 60000,
          input: `FROM ${target}\nRUN node -e "const f=require('fs'),p=require('/app/package.json');p.version='0.0.120';f.writeFileSync('/app/package.json',JSON.stringify(p))"\n`
        }
      )
      execFileSync(
        'docker',
        ['build', '--platform', 'linux/amd64', '-t', broken, '-f', '-', '.'],
        {
          cwd: root,
          encoding: 'utf8',
          timeout: 60000,
          input: `FROM ${target}\nENV UPDATER_PROOF_FAIL=1\nRUN node -e "const f=require('fs'),p=require('/app/package.json');p.version='${nextVersion}';f.writeFileSync('/app/package.json',JSON.stringify(p))"\n`
        }
      )
      docker('network', 'create', network)
      docker('volume', 'create', volume)
      docker('volume', 'create', apps)
      docker(
        'run',
        '-d',
        '--name',
        witness,
        '--network',
        network,
        '--entrypoint',
        'node',
        old,
        '-e',
        'setTimeout(()=>{},600000)'
      )
      const witnessId = inspect(witness).Id
      docker(
        'run',
        '-d',
        '--name',
        name,
        '--network',
        network,
        '--restart',
        'unless-stopped',
        '--memory',
        '768m',
        '--cpus',
        '0.5',
        '--security-opt',
        'no-new-privileges',
        '--label',
        'fixture.keep=unchanged',
        '-v',
        '/var/run/docker.sock:/var/run/docker.sock',
        '-v',
        `${volume}:/app/db`,
        '-v',
        `${apps}:/var/slipway/apps`,
        '-e',
        'NODE_ENV=production',
        '-e',
        'PORT=1337',
        '-e',
        'SLIPWAY_APP_PORT_HOST=127.0.0.1',
        '-e',
        'SESSION_SECRET=fixture-value-not-production',
        old
      )
      let health
      for (let i = 0; i < 90; i++) {
        try {
          health = JSON.parse(
            docker('exec', name, 'curl', '-fsS', 'http://localhost:1337/health')
          )
          if (health.releaseMigrations?.ready) break
        } catch {}
        await pause(1000)
      }
      assert.equal(health?.version, '0.0.120')
      assert.equal(health.releaseMigrations.ready, true)
      const before = inspect(name)
      const output = execFileSync('bash', ['install.sh', targetVersion], {
        cwd: root,
        encoding: 'utf8',
        timeout: 480000,
        maxBuffer: 2 * 1024 * 1024,
        env: {
          ...process.env,
          SLIPWAY_CONTAINER: name,
          SLIPWAY_IMAGE_REPOSITORY: repository,
          SLIPWAY_SKIP_PULL: 'true',
          SLIPWAY_ENV_FILE: path.join(directory, 'must-not-be-created'),
          SLIPWAY_APPS_DIR: '/var/slipway/apps'
        }
      })
      fs.writeFileSync(path.join(directory, 'terminal.log'), output)
      assert.equal(
        fs.existsSync(path.join(directory, 'must-not-be-created')),
        false
      )
      const after = inspect(name)
      assert.notEqual(after.Id, before.Id)
      assert.deepEqual(
        [...after.Config.Env].sort(),
        [...before.Config.Env].sort()
      )
      assert.equal(after.Config.Labels['fixture.keep'], 'unchanged')
      assert.equal(after.HostConfig.Memory, before.HostConfig.Memory)
      assert.equal(after.HostConfig.NanoCpus, before.HostConfig.NanoCpus)
      assert.deepEqual(
        after.HostConfig.RestartPolicy,
        before.HostConfig.RestartPolicy
      )
      assert.deepEqual(
        after.Mounts.map((x) => [
          x.Destination === '/var/run/docker.sock'
            ? 'docker-socket'
            : x.Name || x.Source,
          x.Destination,
          x.RW
        ]).sort(),
        before.Mounts.map((x) => [
          x.Destination === '/var/run/docker.sock'
            ? 'docker-socket'
            : x.Name || x.Source,
          x.Destination,
          x.RW
        ]).sort()
      )
      assert.equal(inspect(witness).Id, witnessId)
      assert.equal(inspect(witness).State.Running, true)
      health = JSON.parse(
        docker('exec', name, 'curl', '-fsS', 'http://localhost:1337/health')
      )
      assert.equal(health.version, targetVersion)
      assert.equal(health.releaseMigrations.ready, true)
      const status = JSON.parse(
        docker(
          'run',
          '--rm',
          '-v',
          '/var/run/docker.sock:/var/run/docker.sock',
          '--entrypoint',
          'node',
          target,
          '/app/bin/slipway-updater.cjs',
          'status',
          '--container',
          name
        )
      )
      assert.equal(status.phase, 'success')
      assert.equal(status.targetVersion, targetVersion)
      const manifest = JSON.parse(
        docker('exec', name, 'cat', status.backupDirectory + '/manifest.json')
      )
      assert.equal(manifest.databases.length, 4)
      assert.ok(
        manifest.databases.every(
          (d) => d.integrity === 'ok' && d.foreignKeys === 'ok'
        )
      )
      // A second real terminal update passes copy-only preflight, then fails
      // normal startup. The exact previous container must be restored.
      const stableId = after.Id
      // Keep the deliberate crash bounded in CI. Successful replacement above
      // already proves preservation of the original unless-stopped policy.
      docker('update', '--restart', 'on-failure:1', name)
      let rejected = false
      try {
        execFileSync('bash', ['install.sh', nextVersion], {
          cwd: root,
          encoding: 'utf8',
          timeout: 480000,
          maxBuffer: 2 * 1024 * 1024,
          env: {
            ...process.env,
            SLIPWAY_CONTAINER: name,
            SLIPWAY_IMAGE_REPOSITORY: repository,
            SLIPWAY_SKIP_PULL: 'true',
            SLIPWAY_ENV_FILE: path.join(directory, 'must-not-be-created')
          }
        })
      } catch (error) {
        rejected = true
        fs.writeFileSync(
          path.join(directory, 'rollback-terminal.log'),
          error.stdout || ''
        )
      }
      assert.equal(rejected, true)
      const rollbackStatus = JSON.parse(
        docker(
          'run',
          '--rm',
          '-v',
          '/var/run/docker.sock:/var/run/docker.sock',
          '--entrypoint',
          'node',
          target,
          '/app/bin/slipway-updater.cjs',
          'status',
          '--container',
          name
        )
      )
      assert.equal(rollbackStatus.phase, 'rolled-back')
      assert.equal(inspect(name).Id, stableId)
      assert.equal(inspect(name).State.Running, true)
      assert.equal(inspect(witness).Id, witnessId)
      assert.equal(
        docker(
          'ps',
          '-a',
          '--filter',
          `name=${name}-next-`,
          '--format',
          '{{.Names}}'
        ),
        ''
      )
      console.log(
        JSON.stringify({
          evidence: directory,
          phase: status.phase,
          version: health.version,
          verifiedDatastores: manifest.databases.length,
          configurationPreserved: true,
          witnessPreserved: true,
          rollbackVerified: true
        })
      )
    } finally {
      const listed = docker('ps', '-a', '--format', '{{.Names}}')
        .split('\n')
        .filter((n) => n === name || n === witness || n.startsWith(name + '-'))
      for (const n of listed)
        try {
          docker('rm', '-f', n)
        } catch {}
      for (const v of [volume, apps])
        try {
          docker('volume', 'rm', v)
        } catch {}
      try {
        docker('network', 'rm', network)
      } catch {}
      for (const image of [broken, old, target])
        try {
          docker('image', 'rm', image)
        } catch {}
    }
  }
)
