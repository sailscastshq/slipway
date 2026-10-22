// Disposable synthetic databases only. Optional revision loads the three policy/source files from Git without changing the checkout.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path'),
  vm = require('node:vm')
const root = path.resolve(process.argv[2]),
  revision = process.argv[3]
const { execFileSync } = require('node:child_process'),
  Module = require('node:module')
const originals = new Map()
if (revision) {
  assert.match(revision, /^[0-9a-f]{40}$/)
  for (const file of [
    'api/lib/release-schema-ready.js',
    'api/lib/release-migrations.js',
    'config/bootstrap.js'
  ])
    originals.set(
      path.join(root, file),
      execFileSync('git', ['show', revision + ':' + file], {
        cwd: root,
        encoding: 'utf8'
      })
    )
  const load = Module._extensions['.js']
  Module._extensions['.js'] = (module, filename) =>
    originals.has(filename)
      ? module._compile(originals.get(filename), filename)
      : load(module, filename)
}
const dbModule = require.resolve(path.join(root, 'node_modules/better-sqlite3'))
const Native = require(dbModule)
let counts = {
  opens: 0,
  closes: 0,
  verificationOpens: 0,
  verificationCloses: 0,
  verificationStatements: 0
}
require.cache[dbModule].exports = new Proxy(Native, {
  construct(Target, args) {
    const verify = args[1]?.readonly === true && args[1]?.fileMustExist === true
    if (verify)
      args[1] = {
        ...args[1],
        verbose: () => {
          counts.verificationStatements++
        }
      }
    const db = new Target(...args)
    counts.opens++
    if (verify) counts.verificationOpens++
    const close = db.close
    db.close = function () {
      if (this.open) {
        counts.closes++
        if (verify) counts.verificationCloses++
      }
      return close.call(this)
    }
    return db
  }
})
const migrations = require(path.join(root, 'api/lib/release-migrations'))
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-833-count-'))
const connections = new Map(),
  rows = []
const stop = Error('fixture completed guarded bootstrap prefix')
;(async () => {
  try {
    await migrations.run({ directory })
    const datastores = Object.fromEntries(
      Object.entries(migrations.files).map(([name, file]) => [
        name,
        { adapter: 'sails-sqlite', url: path.join(directory, file) }
      ])
    )
    for (const [name, c] of Object.entries(datastores))
      connections.set(name, new Native(c.url))
    global.sails = {
      config: { environment: 'console', datastores },
      helpers: {},
      log: { warn() {} },
      getDatastore(name = 'default') {
        const manager = connections.get(name)
        return {
          manager,
          async sendNativeQuery(sql, values = []) {
            assert.doesNotMatch(sql, /^\s*(CREATE|ALTER|DROP|REINDEX)\b/i)
            const s = manager.prepare(sql)
            return s.reader ? { rows: s.all(...values) } : s.run(...values)
          }
        }
      }
    }
    global.Setting = {
      findOne: async () => ({ key: 'teamMembershipMigration' })
    }
    global.App = {
      find: () => ({ decrypt: async () => [] }),
      updateOne: () => ({ set: async () => {} })
    }
    global.Service = { update: () => ({ set: async () => {} }) }
    const source =
      originals.get(path.join(root, 'config/bootstrap.js')) ||
      fs.readFileSync(path.join(root, 'config/bootstrap.js'), 'utf8')
    const calls = [
      ...source.matchAll(/await sails\.helpers\.(\w+)\.(\w+)\(\)/g)
    ].slice(0, 17)
    const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
    for (const [, group, name] of calls) {
      sails.helpers[group] ||= {}
      const fn = require(path.join(root, 'api/helpers', group, kebab(name))).fn
      sails.helpers[group][name] = async () => {
        const before = { ...counts }
        await fn()
        rows.push({
          helper: group + '.' + name,
          opens: counts.verificationOpens - before.verificationOpens,
          closes: counts.verificationCloses - before.verificationCloses
        })
        if (group === 'helm' && name === 'ensureWorkspaceSchema') throw stop
      }
    }
    counts = {
      opens: 0,
      closes: 0,
      verificationOpens: 0,
      verificationCloses: 0,
      verificationStatements: 0
    }
    const context = {
      module: { exports: {} },
      process,
      sails,
      require: (request) => require(path.resolve(root, 'config', request))
    }
    vm.runInNewContext(source, context)
    await assert.rejects(context.module.exports.bootstrap(), (e) => e === stop)
    const prefix = { ...counts }
    const before = { ...counts }
    await require(path.join(
      root,
      'api/helpers/lookout/ensure-observability-schema'
    )).fn()
    console.log(
      JSON.stringify({
        revision:
          revision ||
          execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8'
          }).trim(),
        source: revision ? 'committed revision' : 'working tree',
        fixtureVersion: 1,
        node: process.version,
        betterSqlite: require(path.join(
          root,
          'node_modules/better-sqlite3/package.json'
        )).version,
        helperCalls: rows.length,
        rows,
        bootstrapPrefix: prefix,
        laterGuardedHelper: {
          opens: counts.verificationOpens - before.verificationOpens,
          closes: counts.verificationCloses - before.verificationCloses
        },
        fixture:
          'fresh synthetic release-migrated databases; real helpers/native receipt checks; model backfills mocked; no production data'
      })
    )
  } finally {
    for (const db of connections.values()) db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
