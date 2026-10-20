/**
 * Run Dock's actual isolated ORM script against a disposable Sails/SQLite app.
 * No Docker, existing database, HTTP request, browser or migration is involved.
 * MODEL_HELPER can select an earlier helper to reproduce snapshot truncation.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { performance } = require('node:perf_hooks')
const helper = require(process.env.MODEL_HELPER ||
  path.join(__dirname, '../api/helpers/dock/get-models'))
const tableCount = Number(process.env.MODEL_BENCH_TABLES || 40)
const samples = Number(process.env.MODEL_BENCH_SAMPLES || 7)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-model-bench-'))
const filename = path.join(root, 'fixture.db')

function main() {
  fs.mkdirSync(path.join(root, 'api/models'), { recursive: true })
  fs.mkdirSync(path.join(root, 'config'))
  fs.symlinkSync(
    path.join(__dirname, '../node_modules'),
    path.join(root, 'node_modules')
  )
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      dependencies: { sails: '*', 'sails-hook-orm': '*', 'sails-sqlite': '*' }
    })
  )
  fs.writeFileSync(
    path.join(root, '.sailsrc'),
    JSON.stringify({
      loadHooks: ['moduleloader', 'userconfig', 'userhooks', 'orm']
    })
  )
  fs.writeFileSync(
    path.join(root, 'config/globals.js'),
    `module.exports.globals={_:false,async:false,models:false,sails:${
      process.env.MODEL_BENCH_GLOBALS !== 'off'
    }}`
  )
  fs.writeFileSync(
    path.join(root, 'config/datastores.js'),
    `module.exports.datastores={default:{adapter:'sails-sqlite',url:${JSON.stringify(
      filename
    )}}}`
  )
  fs.writeFileSync(
    path.join(root, 'config/models.js'),
    "module.exports.models={migrate:'safe',attributes:{id:{type:'number',autoIncrement:true}}}"
  )
  fs.writeFileSync(filename, '')
  for (let i = 0; i < tableCount; i++) {
    const attributes = { id: { type: 'number', autoIncrement: true } }
    for (let j = 0; j < 20; j++) attributes[`column_${j}`] = { type: 'string' }
    fs.writeFileSync(
      path.join(root, 'api/models', `Table${i}.js`),
      'module.exports=' +
        JSON.stringify({ tableName: `table_${i}`, attributes })
    )
  }
  const code = helper._private.buildIntrospectionCode(['NODE_ENV=production'])
  const results = []
  for (let i = 0; i <= samples; i++) {
    const started = performance.now()
    const child = spawnSync(process.execPath, [], {
      cwd: root,
      input: code,
      encoding: 'utf8',
      timeout: 25000,
      maxBuffer: 4 * 1024 * 1024
    })
    const elapsedMs = performance.now() - started
    let complete = false
    try {
      const models = JSON.parse(child.stdout)
      complete =
        child.status === 0 &&
        Array.from({ length: tableCount }, (_, n) => n).every(
          (n) => models[`table${n}`]?.attributes.column_19?.type === 'string'
        )
    } catch {
      /* A malformed/partial snapshot is a failed runtime read. */
    }
    if (i)
      results.push({
        complete,
        elapsedMs,
        bytes: Buffer.byteLength(child.stdout || ''),
        exitCode: child.status
      })
  }
  const successful = results.filter((result) => result.complete)
  const timings = successful
    .map((result) => result.elapsedMs)
    .sort((a, b) => a - b)
  console.log(
    JSON.stringify(
      {
        fixture:
          'actual isolated Sails/SQLite ORM inspection; no Docker, preflight, HTTP or browser',
        node: process.version,
        applicationModels: tableCount,
        columnsPerModel: 20,
        samples,
        successfulSnapshots: successful.length,
        failedSnapshots: samples - successful.length,
        completeSnapshotP50Ms: timings.length
          ? +timings[Math.floor(timings.length / 2)].toFixed(2)
          : null,
        completeSnapshotP95Ms: timings.length
          ? +timings[
              Math.min(timings.length - 1, Math.floor(timings.length * 0.95))
            ].toFixed(2)
          : null,
        outputBytes: [...new Set(results.map((result) => result.bytes))],
        childExitCodes: [...new Set(results.map((result) => result.exitCode))]
      },
      null,
      2
    )
  )
}
try {
  main()
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
