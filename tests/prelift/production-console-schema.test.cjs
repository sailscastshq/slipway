const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const migrations = require('../../api/lib/release-migrations')
const root = path.resolve(__dirname, '../..')

async function bootstrapEnvironment(environment, nodeEnvironment) {
  const env = { NODE_ENV: nodeEnvironment }
  const stop = Error('fixture stops before schema initialization')
  const context = {
    module: { exports: {} },
    process: { env },
    sails: {
      config: { environment },
      helpers: {
        auth: {
          ensureSchema: async () => {
            throw stop
          }
        }
      }
    }
  }
  vm.runInNewContext(
    fs.readFileSync(path.join(root, 'config/bootstrap.js'), 'utf8'),
    context
  )
  await assert.rejects(
    context.module.exports.bootstrap(),
    (error) => error === stop
  )
  return env
}

test('production bootstrap passes the schema requirement to a console child without changing NODE_ENV', async () => {
  for (const [environment, nodeEnvironment] of [
    ['production', 'production'],
    ['production', 'development'],
    ['test', 'production']
  ]) {
    const env = await bootstrapEnvironment(environment, nodeEnvironment)
    assert.equal(env.SLIPWAY_RELEASE_SCHEMA_REQUIRED, '1')
    assert.equal(env.NODE_ENV, nodeEnvironment)
  }
  for (const environment of ['console', 'development', 'test']) {
    const env = await bootstrapEnvironment(environment, environment)
    assert.equal(env.SLIPWAY_RELEASE_SCHEMA_REQUIRED, undefined)
  }
})

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
    const inherited = await bootstrapEnvironment('production', 'production')
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
