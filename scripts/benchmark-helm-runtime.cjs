/**
 * Synthetic Helm startup benchmark. Run in a container with Sails, ORM, and
 * SQLite installed; see docs/helm-runtime-contract.md for the Docker command.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const runtime = require(process.env.HELM_RUNTIME_MODULE ||
  path.join(__dirname, '../api/lib/helm-runtime'))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-bench-app-'))
fs.mkdirSync(path.join(root, 'config/env'), { recursive: true })
fs.mkdirSync(path.join(root, 'api/models'), { recursive: true })
fs.writeFileSync(
  path.join(root, 'package.json'),
  JSON.stringify({
    dependencies: { sails: '*', 'sails-hook-orm': '*', 'sails-sqlite': '*' }
  })
)
fs.symlinkSync(
  process.env.HELM_NODE_MODULES || path.join(__dirname, '../node_modules'),
  path.join(root, 'node_modules')
)
fs.writeFileSync(
  path.join(root, '.sailsrc'),
  JSON.stringify({
    loadHooks: ['moduleloader', 'userconfig', 'userhooks', 'orm'],
    models: { migrate: 'safe' }
  })
)
fs.writeFileSync(
  path.join(root, 'config/datastores.js'),
  "module.exports.datastores={default:{adapter:'sails-sqlite',url:'./bench.db'}}"
)
fs.writeFileSync(
  path.join(root, 'api/models/User.js'),
  "module.exports={attributes:{id:{type:'number',autoIncrement:true},name:{type:'string'}}}"
)
const metadata = {
  version: 1,
  truncated: false,
  models: [
    {
      identity: 'user',
      globalId: 'User',
      attributes: [{ name: 'name', type: 'string', association: null }]
    }
  ],
  helpers: [],
  config: []
}
function sample(mode) {
  const prepared = runtime.prepareSource('1 + 1')
  const runner = runtime.buildRunnerSource({
    preparedSource: prepared.source,
    bootstrapSails: mode === 'lift',
    metadataOnly: mode === 'metadata',
    appContext:
      mode === 'metadata'
        ? { completionMetadata: metadata }
        : {
            appPath: root,
            env: { PATH: process.env.PATH, HOME: root, NODE_ENV: 'production' },
            argv: [process.execPath, 'app.js']
          },
    timeoutMs: 15000
  })
  const start = process.hrtime.bigint()
  const processResult = spawnSync(process.execPath, [], {
    input:
      "process.on('exit',()=>console.error('PEAK_RSS_KIB='+process.resourceUsage().maxRSS));\n" +
      runner,
    encoding: 'utf8',
    timeout: 18000,
    maxBuffer: 1024 * 1024
  })
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6
  let envelope
  try {
    envelope = runtime.parseRunnerOutput(processResult.stdout)
  } catch (error) {
    throw new Error(
      processResult.stderr + '\n' + processResult.stdout + '\n' + error.message
    )
  }
  if (!envelope.success) throw new Error(JSON.stringify(envelope.error))
  const peakRssKiB = Number(
    processResult.stderr.match(/PEAK_RSS_KIB=(\d+)/)?.[1]
  )
  return { wallMs, peakRssMiB: peakRssKiB / 1024 }
}
function percentile(sorted, fraction) {
  return sorted[Math.ceil(sorted.length * fraction) - 1]
}
const samples = Number(process.env.HELM_BENCH_SAMPLES || 12)
for (const mode of ['metadata', 'lift']) {
  const values = []
  for (let i = 0; i < samples; i++) values.push(sample(mode))
  const latency = values.map((x) => x.wallMs).sort((a, b) => a - b)
  const rss = values.map((x) => x.peakRssMiB).sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      mode,
      count: values.length,
      p50Ms: +percentile(latency, 0.5).toFixed(1),
      p95Ms: +percentile(latency, 0.95).toFixed(1),
      peakRssMiB: +Math.max(...rss).toFixed(1)
    })
  )
}
fs.rmSync(root, { recursive: true, force: true })
