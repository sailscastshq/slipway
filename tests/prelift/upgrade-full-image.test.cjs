const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const signature = require('cookie-signature')
const docker = require('../../api/lib/upgrade-docker-api')()
const host = require('../../api/lib/upgrade-host-controller')
const enabled =
  process.platform === 'linux' && process.env.SLIPWAY_FULL_IMAGE_FIXTURE === '1'
function cli(args, input) {
  return execFileSync('docker', args, {
    input,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 1024 * 1024
  }).trim()
}
const secret = 'synthetic-full-image-session-secret-never-a-real-account'
async function info(id) {
  return docker('GET', `/containers/${id}/json`)
}
async function url(id) {
  const container = await info(id)
  return `http://127.0.0.1:${container.NetworkSettings.Ports['1337/tcp'][0].HostPort}`
}
async function healthy(id) {
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    try {
      const response = await fetch((await url(id)) + '/health', {
        signal: AbortSignal.timeout(2000)
      })
      if (response.ok) return await response.json()
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error('Disposable full-image readiness was not confirmed')
}
let nativeRunSequence = 0
async function runController({ input, directory, image, sourceId }) {
  const name =
    'slipway-native-controller-' + ++nativeRunSequence + '-' + process.pid
  const bundleDirectory = process.env.SLIPWAY_NATIVE_HOST_BUNDLE_DIR
  assert.ok(bundleDirectory, 'The verified Linux host bundle is required')
  const native = require(path.join(
    bundleDirectory,
    'scripts/upgrade-host-native.cjs'
  ))
  const requested = {
    operation:
      input.operation ||
      (input.filename
        ? 'resume'
        : input.reviewed?.sourceVersion === 'fresh'
        ? 'initialize'
        : 'apply'),
    container: sourceId,
    directory,
    image,
    instanceId: input.instanceId || input.reviewed?.instanceId,
    approval: input.approval || input.reviewed?.reviewHash,
    ...(input.filename ? { filename: input.filename } : {}),
    failHealth: input.failHealth,
    bundleDirectory
  }
  const result = await native.supervise(requested, {
    worker: path.resolve(__dirname, 'fixtures/upgrade-native-full-worker.cjs'),
    timeoutMs: 240000
  })
  if (!result.success) {
    const evidence = path.resolve(
      process.env.SLIPWAY_FULL_IMAGE_DIAGNOSTICS ||
        '.tmp/upgrade-full-image-diagnostics'
    )
    // Only the redacted report is runner-readable; requests/storage stay private.
    fs.mkdirSync(evidence, { recursive: true, mode: 0o755 })
    fs.writeFileSync(
      path.join(evidence, name + '.json'),
      JSON.stringify({
        head: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
          timeout: 2000,
          maxBuffer: 1024
        }).trim(),
        code: /^upgrade[A-Za-z]+$/.test(result.code || '')
          ? result.code
          : 'unconfirmed',
        catalog: result.catalog || { status: 'unconfirmed' },
        storageStaged: result.storageStaged,
        backupsVerified: result.backupsVerified,
        receiptsPrepared: result.receiptsPrepared
      }),
      { mode: 0o644, flag: 'wx' }
    )
  }
  return result
}

test(
  'actual coordinated image preserves founder session/encryption and proves container writer fencing, failed health, resume and worker admission',
  { skip: !enabled, timeout: 720000 },
  async () => {
    assert.equal(process.getuid(), 0)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-full-'))
    const original = path.join(root, 'original'),
      directory = path.join(root, 'upgrades'),
      apps = path.join(root, 'apps')
    for (const item of [original, directory, apps])
      fs.mkdirSync(item, { mode: 0o700 })
    const containers = []
    const sourceName = 'slipway-full-source-' + process.pid
    const image = process.env.SLIPWAY_FULL_IMAGE
    let sourceId, candidate
    try {
      const sourceVersion =
        process.env.SLIPWAY_FULL_IMAGE_SOURCE_VERSION || '0.0.87'
      assert.ok(['0.0.86', '0.0.87'].includes(sourceVersion))
      const sourceTag = 'ghcr.io/sailscastshq/slipway:' + sourceVersion
      cli(['pull', sourceTag])
      const sourceImage = cli([
        'image',
        'inspect',
        '--format',
        '{{index .RepoDigests 0}}',
        sourceTag
      ])
      async function source(environment) {
        const created = await docker(
          'POST',
          `/containers/create?name=${sourceName}`,
          {
            Image: sourceImage,
            Cmd: ['node', 'app.js'],
            Env: [
              `NODE_ENV=${environment}`,
              'PORT=1337',
              'SLIPWAY_URL=http://127.0.0.1',
              `SESSION_SECRET=${secret}`,
              'DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
              'SLIPWAY_SETUP_TOKEN=synthetic-unused-install-claim'
            ],
            ExposedPorts: { '1337/tcp': {} },
            HostConfig: {
              NetworkMode: 'bridge',
              RestartPolicy: { Name: 'always' },
              PortBindings: {
                '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }]
              },
              Mounts: [
                { Type: 'bind', Source: original, Target: '/app/db' },
                { Type: 'bind', Source: apps, Target: '/var/slipway/apps' },
                {
                  Type: 'bind',
                  Source: '/var/run/docker.sock',
                  Target: '/var/run/docker.sock'
                }
              ]
            },
            NetworkingConfig: { EndpointsConfig: { bridge: {} } }
          }
        )
        containers.push(created.Id)
        await docker('POST', `/containers/${created.Id}/start`)
        await healthy(created.Id)
        return created.Id
      }
      sourceId = await source('development')
      const seeded = cli(
        ['exec', '-e', 'PORT=13499', '-i', sourceId, 'node'],
        `const s=require('sails');s.lift({environment:'console',port:13499,log:{level:'error'},models:{migrate:'safe',dataEncryptionKeys:{default:process.env.DATA_ENCRYPTION_KEY}}},async error=>{try{if(error)throw error;const u=await User.create({fullName:'Fixture Founder',email:'fixture@example.invalid',password:'synthetic-fixture-password',isGenesisUser:true,authVersion:'fixture-auth'}).fetch();const t=await Team.create({name:'Fixture Team',slug:'fixture-team',owner:u.id}).fetch();await User.updateOne(u.id).set({team:t.id});const p=await Project.create({name:'Fixture Project',slug:'fixture-project',team:t.id,createdBy:u.id}).fetch();const e=await Environment.create({name:'Production',slug:'production',project:p.id,isProduction:true}).fetch();await App.create({name:'Fixture',slug:'fixture',environment:e.id,secureEnvVars:{TOKEN:'fixture-only'}});process.stdout.write('FIXTURE_SEEDED');s.lower(()=>process.exit(0))}catch{process.stderr.write('FIXTURE_SEED_FAILED');process.exit(1)}})`
      )
      assert.ok(seeded.includes('FIXTURE_SEEDED'))
      await docker('POST', `/containers/${sourceId}/update`, {
        RestartPolicy: { Name: 'no' }
      })
      await docker('POST', `/containers/${sourceId}/stop?t=10`)
      await docker('DELETE', `/containers/${sourceId}`)
      sourceId = await source('production')
      const db = new Database(path.join(original, 'app.db'), { readonly: true })
      const founder = db
        .prepare(
          "SELECT id,auth_version,team,is_genesis_user FROM users WHERE email='fixture@example.invalid'"
        )
        .get()
      db.close()
      assert.ok(
        founder,
        'The real seeded founder must persist across the source restart'
      )
      assert.ok(
        [1, '1', 'true', '1.0'].includes(founder.is_genesis_user),
        'The real founder must retain native founder authority'
      )
      const sid = 'synthetic-browser-session'
      const sessions = new Database(path.join(original, 'session.db'))
      sessions
        .prepare(
          'INSERT OR REPLACE INTO sessions(sid,sess,expired) VALUES(?,?,?)'
        )
        .run(
          'sess:' + sid,
          JSON.stringify({
            cookie: {
              originalMaxAge: 3600000,
              expires: new Date(Date.now() + 3600000).toISOString(),
              httpOnly: true,
              secure: false,
              path: '/'
            },
            userId: founder.id,
            authVersion: founder.auth_version,
            activeTeamId: founder.team
          }),
          Date.now() + 3600000
        )
      sessions.close()
      const cookie =
        'slipway.sid.v2=' +
        encodeURIComponent('s:' + signature.sign(sid, secret))
      async function profile(id) {
        const response = await fetch((await url(id)) + '/profile', {
          headers: { Cookie: cookie, 'X-Inertia': 'true' },
          redirect: 'manual',
          signal: AbortSignal.timeout(5000)
        })
        assert.equal(
          response.status,
          200,
          'Existing founder session must remain authenticated'
        )
      }
      await profile(sourceId)
      fs.writeFileSync(
        path.join(original, 'opaque.fixture'),
        'synthetic-existing-opaque-key',
        { mode: 0o600 }
      )
      const controller = (input) =>
        runController({
          input,
          containers,
          directory,
          image,
          sourceId,
          original
        })
      const reviewed = await controller({ operation: 'plan' })
      assert.equal(reviewed.success, true, JSON.stringify(reviewed))
      const failed = await controller({ reviewed, failHealth: true })
      assert.equal(failed.code, 'upgradeHostHealth', JSON.stringify(failed))
      const held = host.read(failed.filename)
      candidate = held.target.id
      assert.equal((await info(sourceId)).State.Running, false)
      assert.equal((await info(sourceId)).HostConfig.RestartPolicy.Name, 'no')
      assert.equal((await info(candidate)).State.Running, false)
      assert.equal((await info(candidate)).HostConfig.RestartPolicy.Name, 'no')
      const resumed = await controller({
        filename: failed.filename,
        approval: reviewed.reviewHash,
        instanceId: reviewed.instanceId
      })
      assert.equal(resumed.success, true, JSON.stringify(resumed))
      assert.equal(resumed.phase, 'ready')
      const state = host.read(resumed.filename)
      assert.equal(state.target.id, candidate)
      const health = await healthy(candidate)
      assert.equal(health.version, '0.0.88')
      assert.equal(health.upgrade.verified, true)
      assert.equal(health.upgrade.manifestHash, reviewed.identity.hash)
      await profile(candidate)
      assert.equal(
        fs.readFileSync(
          path.join(state.stage.dataDirectory, 'opaque.fixture'),
          'utf8'
        ),
        'synthetic-existing-opaque-key'
      )
      for (const service of host.services(original, reviewed.instanceId)) {
        const db = new Database(service.path, { readonly: true })
        assert.equal(
          db
            .prepare(
              "SELECT count(*) AS n FROM sqlite_schema WHERE name='_slipway_upgrade_ledger_v1'"
            )
            .get().n,
          0
        )
        db.close()
      }
      const worker = cli(
        ['exec', '-e', 'PORT=13499', '-i', candidate, 'node'],
        `const s=require('sails');s.lift({environment:'console',port:13499,log:{level:'error'},models:{migrate:'safe',dataEncryptionKeys:{default:process.env.DATA_ENCRYPTION_KEY}}},async error=>{try{if(error)throw error;const app=await App.findOne({slug:'fixture'}).decrypt();if(!s.upgradeAdmission?.verified||app.secureEnvVars.TOKEN!=='fixture-only')throw Error();process.stdout.write('FIXTURE_VERIFIED_WORKER_AND_ENCRYPTION');s.lower(()=>process.exit(0))}catch{process.stderr.write('FIXTURE_WORKER_FAILED');process.exit(1)}})`
      )
      assert.ok(worker.includes('FIXTURE_VERIFIED_WORKER_AND_ENCRYPTION'))
      for (const args of [
        [
          'run',
          '--rm',
          '--network',
          'none',
          '--entrypoint',
          'node',
          image,
          'app.js'
        ],
        [
          'exec',
          '-e',
          'SLIPWAY_UPGRADE_MANIFEST=' + 'f'.repeat(64),
          candidate,
          'node',
          '-e',
          'require("./config/datastores")'
        ]
      ]) {
        let rejected
        try {
          cli(args)
        } catch (error) {
          rejected = error
        }
        assert.ok(
          rejected && rejected.status !== 0,
          'Unadmitted main/worker startup must fail'
        )
      }
      assert.equal(
        (await info(candidate)).HostConfig.RestartPolicy.Name,
        'always'
      )
    } finally {
      if (candidate) {
        try {
          await docker('DELETE', `/containers/${candidate}?force=1`)
        } catch {}
      }
      for (const id of containers.reverse()) {
        try {
          await docker('DELETE', `/containers/${id}?force=1`)
        } catch {}
      }
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)

test(
  'never-started fresh template reaches verified actual-image startup through the native engine',
  { skip: !enabled, timeout: 360000 },
  async () => {
    assert.equal(process.getuid(), 0)
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-fresh-full-'))
    const original = path.join(root, 'original'),
      directory = path.join(root, 'upgrades'),
      apps = path.join(root, 'apps')
    for (const item of [original, directory, apps])
      fs.mkdirSync(item, { mode: 0o700 })
    const containers = [],
      image = process.env.SLIPWAY_FULL_IMAGE
    const name = 'slipway-fresh-full-source-' + process.pid
    let candidate
    try {
      require('../../api/lib/upgrade-fresh-storage')(original)
      const created = await docker('POST', `/containers/create?name=${name}`, {
        Image: image,
        Cmd: ['node', 'app.js'],
        Labels: { 'io.slipway.install.pending': 'true' },
        Env: [
          'NODE_ENV=production',
          'PORT=1337',
          'SLIPWAY_URL=http://127.0.0.1',
          `SESSION_SECRET=${secret}`,
          'DATA_ENCRYPTION_KEY=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          'SLIPWAY_SETUP_TOKEN=synthetic-unused-install-claim'
        ],
        ExposedPorts: { '1337/tcp': {} },
        HostConfig: {
          NetworkMode: 'bridge',
          RestartPolicy: { Name: 'always' },
          PortBindings: {
            '1337/tcp': [{ HostIp: '127.0.0.1', HostPort: '0' }]
          },
          Mounts: [
            { Type: 'bind', Source: original, Target: '/app/db' },
            { Type: 'bind', Source: apps, Target: '/var/slipway/apps' },
            {
              Type: 'bind',
              Source: '/var/run/docker.sock',
              Target: '/var/run/docker.sock'
            }
          ]
        },
        NetworkingConfig: { EndpointsConfig: { bridge: {} } }
      })
      containers.push(created.Id)
      assert.equal((await info(created.Id)).State.Status, 'created')
      const reviewed = host.plan({
        sourceDirectory: original,
        instanceId: 'full-fresh-fixture',
        image,
        sourceVersion: 'fresh',
        containerId: created.Id,
        containerName: name
      })
      const result = await runController({
        input: { reviewed },
        containers,
        directory,
        image,
        sourceId: created.Id,
        original
      })
      assert.equal(
        result.success,
        true,
        JSON.stringify({ code: result.code, filename: result.filename })
      )
      assert.equal(result.phase, 'ready')
      const state = host.read(result.filename)
      candidate = state.target.id
      const health = await healthy(candidate)
      assert.equal(health.version, '0.0.88')
      assert.equal(health.upgrade.verified, true)
      assert.equal(health.upgrade.manifestHash, state.reviewed.identity.hash)
      const response = await fetch((await url(candidate)) + '/setup', {
        signal: AbortSignal.timeout(5000),
        redirect: 'manual'
      })
      assert.equal(response.status, 200)
      for (const service of host.services(original, reviewed.instanceId)) {
        const db = new Database(service.path, { readonly: true })
        assert.equal(
          db
            .prepare(
              "SELECT count(*) AS n FROM sqlite_schema WHERE type='table'"
            )
            .get().n,
          0
        )
        db.close()
      }
      assert.equal(
        (await info(candidate)).HostConfig.RestartPolicy.Name,
        'always'
      )
      if (process.env.SLIPWAY_FRESH_BASELINE_OUTPUT) {
        await docker('POST', `/containers/${candidate}/update`, {
          RestartPolicy: { Name: 'no' }
        })
        await docker('POST', `/containers/${candidate}/stop?t=30`)
        const stopped = await info(candidate)
        assert.equal(stopped.State.Running, false)
        const copy = path.join(root, 'baseline-copy')
        const storage = stopped.Mounts.find(
          (mount) => mount.Destination === '/app/db'
        )
        fs.cpSync(storage.Source, copy, { recursive: true })
        const ledger = require('../../api/lib/upgrade-ledger')
        const databases = {}
        const expected = require('../../api/lib/upgrades/baselines/current-fresh.json')
        for (const service of host.services(copy, reviewed.instanceId)) {
          const db = new Database(service.path, { readonly: true })
          assert.equal(db.pragma('integrity_check', { simple: true }), 'ok')
          assert.equal(db.pragma('foreign_key_check').length, 0)
          const schemaHash = ledger.schemaHash({
            ...service,
            transaction: { database: db }
          })
          assert.equal(
            schemaHash,
            expected.databases[service.datastore].schemaHash
          )
          databases[service.datastore] = { present: true, schemaHash }
          db.close()
        }
        fs.writeFileSync(
          process.env.SLIPWAY_FRESH_BASELINE_OUTPUT,
          JSON.stringify(
            {
              format: 1,
              version: health.version,
              image,
              nativeVerified: health.upgrade.verified,
              databases
            },
            null,
            2
          ) + '\n',
          { mode: 0o644 }
        )
      }
    } finally {
      if (candidate) containers.push(candidate)
      for (const id of new Set(containers))
        await docker('DELETE', `/containers/${id}?force=1`).catch(() => {})
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
)
