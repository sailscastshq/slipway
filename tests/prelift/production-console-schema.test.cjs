const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const migrations = require('../../api/lib/release-migrations')
const root = path.resolve(__dirname, '../..')

function configureEnvironment(environment, nodeEnvironment) {
  const env = { NODE_ENV: nodeEnvironment }
  const context = {
    module: { exports: {} },
    process: { env },
    require: () => ({
      create() {
        throw Error('initialization is outside this fixture')
      }
    })
  }
  vm.runInNewContext(
    fs.readFileSync(
      path.join(root, 'api/hooks/instance-quest/index.js'),
      'utf8'
    ),
    context
  )
  context.module.exports({ config: { environment } }).configure()
  return env
}

test('production hook configuration passes the schema requirement to a console child without changing NODE_ENV', async () => {
  for (const [environment, nodeEnvironment] of [
    ['production', 'production'],
    ['production', 'development'],
    ['test', 'production']
  ]) {
    const env = configureEnvironment(environment, nodeEnvironment)
    assert.equal(env.SLIPWAY_RELEASE_SCHEMA_REQUIRED, '1')
    assert.equal(env.NODE_ENV, nodeEnvironment)
  }
  for (const environment of ['console', 'development', 'test']) {
    const env = configureEnvironment(environment, environment)
    assert.equal(env.SLIPWAY_RELEASE_SCHEMA_REQUIRED, undefined)
  }
})

test(
  'real Quest scheduled child inherits production policy while another hook still blocks bootstrap',
  { timeout: 25000 },
  async (t) => {
    const { Sails } = require('sails')
    const defineQuest = require('sails-hook-quest')
    const defineInstanceQuest = require('../../api/hooks/instance-quest')
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-early-quest-')
    )
    const output = path.join(directory, 'child-policy.json')
    const previous = process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED
    delete process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED
    const app = new Sails()
    let bootstrapEntered = false
    let childBeforeBootstrap = false
    t.after(async () => {
      await app.quest?.stop()
      await new Promise((resolve) => app.lower(resolve))
      if (previous === undefined)
        delete process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED
      else process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED = previous
      fs.rmSync(directory, { recursive: true, force: true })
    })
    fs.mkdirSync(path.join(directory, 'scripts'))
    fs.mkdirSync(path.join(directory, 'config', 'env'), { recursive: true })
    fs.symlinkSync(
      path.join(root, 'node_modules'),
      path.join(directory, 'node_modules'),
      'dir'
    )
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({ name: 'early-quest-policy-fixture', scripts: {} })
    )
    fs.writeFileSync(
      path.join(directory, 'config/env/console.js'),
      `module.exports={bootstrap:false,loadHooks:['moduleloader','userconfig','userhooks'],hooks:{orm:false,grunt:false,session:false,sockets:false}}`
    )
    fs.writeFileSync(
      path.join(directory, 'scripts/early-policy.js'),
      `module.exports={friendlyName:'Early policy fixture',quest:{interval:100,withoutOverlapping:true},fn:async function(){require('node:fs').writeFileSync(${JSON.stringify(
        output
      )},JSON.stringify({marker:process.env.SLIPWAY_RELEASE_SCHEMA_REQUIRED,nodeEnvironment:process.env.NODE_ENV}));return true}}`
    )
    await new Promise((resolve, reject) =>
      app.lift(
        {
          appPath: directory,
          environment: 'production',
          globals: false,
          log: { level: 'silent' },
          hookTimeout: 20000,
          loadHooks: [
            'moduleloader',
            'userconfig',
            'userhooks',
            'quest',
            'schema-policy',
            'hold-hooks'
          ],
          hooks: {
            quest: defineQuest,
            'schema-policy': (sails) => ({
              configure: defineInstanceQuest(sails).configure
            }),
            'hold-hooks': () => ({
              initialize(done) {
                const deadline = Date.now() + 15000
                const poll = () => {
                  if (fs.existsSync(output)) {
                    childBeforeBootstrap = !bootstrapEntered
                    done()
                  } else if (Date.now() > deadline)
                    done(
                      Error('scheduled child did not complete before bootstrap')
                    )
                  else setTimeout(poll, 25)
                }
                poll()
              }
            })
          },
          quest: {
            autoStart: true,
            environment: 'console',
            sailsPath: path.join(root, 'node_modules/.bin/sails'),
            scriptsDir: 'scripts'
          },
          bootstrap(done) {
            bootstrapEntered = true
            done()
          }
        },
        (error) => (error ? reject(error) : resolve())
      )
    )
    assert.equal(bootstrapEntered, true)
    assert.equal(childBeforeBootstrap, true)
    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
      marker: '1',
      nodeEnvironment: 'console'
    })
  }
)

const child = `
const assert = require('node:assert/strict')
const path = require('node:path')
const Database = require('better-sqlite3')
const root = process.argv[1], directory = process.argv[2]
const migrations = require(path.join(root, 'api/lib/release-migrations'))
const datastores = Object.fromEntries(Object.entries(migrations.files).map(([name,file]) => [name, {adapter:'sails-sqlite',url:path.join(directory,file)}]))
const connections = new Map(), queries = [], native = []
global.sails = {
  config: {environment:process.argv[3],datastores},
  getDatastore(name='default') {
    if(!connections.has(name)) connections.set(name,new Database(datastores[name].url,{verbose:sql=>native.push(sql)}))
    const manager=connections.get(name)
    return {manager,async sendNativeQuery(sql,values=[]) {
      queries.push(sql)
      assert.doesNotMatch(sql,/^\\s*(CREATE|ALTER|DROP|REINDEX)\\b/i)
      const statement=manager.prepare(sql)
      return statement.reader ? {rows:statement.all(...values)} : statement.run(...values)
    }}
  }
}
;(async()=>{
 try {
   const ready=require(path.join(root,'api/lib/release-schema-ready'))
   const expected=process.argv[4]
   if(expected==='legacy') assert.equal(ready(sails),false)
   else if(expected==='blocked'||expected==='absent') {
     assert.throws(()=>ready(sails),error=>expected==='absent'
       ? error.code==='SQLITE_CANTOPEN'
       : /release schema is not ready/.test(error.message))
     assert.equal(queries.length,0)
   } else {
     assert.equal(ready(sails),true)
     for(const helper of ['auth/ensure-schema','wake/ensure-schema','lookout/ensure-observability-schema'])
       await require(path.join(root,'api/helpers',helper)).fn()
     assert.equal(sails.wakeStorageReady,true)
     assert.equal(queries.length,3)
     assert.ok(queries.every(sql=>/^UPDATE telemetry_/.test(sql)))
     assert.ok(native.every(sql=>!/^\\s*(CREATE|ALTER|DROP|REINDEX)\\b/i.test(sql)))
   }
   console.log(JSON.stringify({result:expected,queryCount:queries.length}))
 } finally {for(const db of connections.values()) db.close()}
})().catch(error=>{console.error(error);process.exitCode=1})
`

test('production-origin console helpers verify real receipts, suppress DDL and fail closed on missing receipts', async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-console-schema-')
  )
  try {
    await migrations.run({ directory })
    const inherited = configureEnvironment('production', 'production')
    const run = (environment, env, expected, database = directory) => {
      const result = spawnSync(
        process.execPath,
        ['-e', child, root, database, environment, expected],
        {
          cwd: root,
          env: { ...env, QUEST_RUN_ID: 'synthetic-console-schema-check' },
          encoding: 'utf8',
          timeout: 20000
        }
      )
      assert.equal(result.status, 0, result.stderr || result.error?.message)
      assert.equal(JSON.parse(result.stdout).result, expected)
    }
    // Same inherited environment rewrite performed by Quest's executor.
    run('console', { ...inherited, NODE_ENV: 'console' }, 'ready')
    run('console', { NODE_ENV: 'console' }, 'legacy')
    run('test', { NODE_ENV: 'test' }, 'legacy')
    run(
      'console',
      { NODE_ENV: 'console', SLIPWAY_RELEASE_SCHEMA_REQUIRED: '0' },
      'legacy'
    )
    // Existing explicit production overrides cannot be disabled by the marker.
    run(
      'production',
      { NODE_ENV: 'console', SLIPWAY_RELEASE_SCHEMA_REQUIRED: '0' },
      'ready'
    )
    run(
      'test',
      { NODE_ENV: 'production', SLIPWAY_RELEASE_SCHEMA_REQUIRED: '0' },
      'ready'
    )
    const empty = fs.mkdtempSync(
      path.join(os.tmpdir(), 'slipway-console-unready-')
    )
    try {
      run('console', { ...inherited, NODE_ENV: 'console' }, 'absent', empty)
      assert.deepEqual(fs.readdirSync(empty), [])
      const Database = require('better-sqlite3')
      for (const file of Object.values(migrations.files))
        new Database(path.join(empty, file)).close()
      const before = Object.values(migrations.files).map((file) =>
        fs.readFileSync(path.join(empty, file))
      )
      run('console', { ...inherited, NODE_ENV: 'console' }, 'blocked', empty)
      assert.deepEqual(
        Object.values(migrations.files).map((file) =>
          fs.readFileSync(path.join(empty, file))
        ),
        before
      )
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
