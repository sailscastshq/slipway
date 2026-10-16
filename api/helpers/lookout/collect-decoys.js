const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { createHash } = require('node:crypto')
const exec = promisify(execFile)
const decoys = require('./decoy-config')._private
let running = false
let offset = 0

module.exports = {
  friendlyName: 'Collect decoys',
  description:
    'Admit a bounded sample of proxy-only observations separately from HTTP spans.',
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    if (running) return { admitted: 0 }
    running = true
    try {
      const apps = (
        await sails.helpers.lookout.decoyConfig(
          await App.find({ hostPort: { '>': 0 } })
        )
      ).filter((a) => a.lookoutDecoys?.enabled)
      if (!apps.length) return { admitted: 0 }
      const environments = [...new Set(apps.map((a) => String(a.environment)))]
      const scheduled = [
        ...environments.slice(offset),
        ...environments.slice(0, offset)
      ].slice(0, 4)
      let admitted = 0
      let processed = 0
      for (const environment of scheduled) {
        if (admitted >= 200) break
        processed++
        try {
          const stdout = await readLog(
            sails.config.docker?.binaryPath || 'docker',
            sails.config.custom.slipwayProxyContainer || 'slipway-proxy',
            decoys.logIdentity(environment).file
          )
          const existing = await TelemetryMetric.find({
            environment,
            name: 'lookout.decoy_hit',
            recordedAt: { '>=': Date.now() - 7 * 86400000 }
          })
            .sort('recordedAt DESC')
            .limit(1000)
          const seen = new Set(existing.map((m) => m.attributes?.observationId))
          const records = observations(
            stdout,
            apps.filter((a) => String(a.environment) === environment),
            seen,
            Date.now(),
            200 - admitted
          )
          if (records.length) await TelemetryMetric.createEach(records)
          admitted += records.length
        } catch {
          // Missing/oversized logs or an unavailable proxy never block app-log collection.
          sails.log.verbose('Lookout Decoys: bounded proxy sample unavailable')
        }
      }
      offset = (offset + processed) % environments.length
      return { admitted }
    } finally {
      running = false
    }
  }
}

function observations(
  raw,
  apps,
  seen = new Set(),
  now = Date.now(),
  limit = 200
) {
  if (Buffer.byteLength(raw) > 262144) return []
  const allowed = new Map()
  for (const app of apps)
    for (const path of app.lookoutDecoys.paths)
      allowed.set(decoys.token(app, path), {
        app,
        path: decoys.effectivePath(app, path)
      })
  const records = []
  const counts = new Map()
  for (const line of raw.split('\n').slice(-1000).reverse()) {
    if (records.length >= Math.min(200, limit)) break
    if (line.length > 2048) continue
    let log
    try {
      log = JSON.parse(line)
    } catch {
      continue
    }
    const match = allowed.get(log.slipway_decoy)
    if (
      !match ||
      !['GET', 'HEAD'].includes(log.decoy_method) ||
      !Number.isInteger(log.status) ||
      log.status < 100 ||
      log.status > 599 ||
      typeof log.ts !== 'number' ||
      !Number.isFinite(log.ts)
    )
      continue
    const recordedAt = Math.round(log.ts * 1000)
    if (recordedAt < now - 7 * 86400000 || recordedAt > now + 60000) continue
    const observationId = createHash('sha256').update(line).digest('hex')
    if (seen.has(observationId) || (counts.get(match.app.id) || 0) >= 50)
      continue
    seen.add(observationId)
    counts.set(match.app.id, (counts.get(match.app.id) || 0) + 1)
    records.push({
      name: 'lookout.decoy_hit',
      value: 1,
      unit: 'count',
      recordedAt,
      environment: String(match.app.environment),
      attributes: {
        kind: 'decoy_hit',
        appId: String(match.app.id),
        path: match.path,
        method: log.decoy_method,
        statusCode: log.status,
        revision: match.app.lookoutDecoys.revision,
        observationId
      }
    })
  }
  return records
}
async function readLog(binary, container, file) {
  // The supported proxy image is distroless. Docker's archive API reads the
  // existing volume without installing utilities or mounting it elsewhere.
  const { stdout } = await exec(binary, ['cp', `${container}:${file}`, '-'], {
    timeout: 5000,
    maxBuffer: 2 * 1024 * 1024 + 65536,
    encoding: 'buffer'
  })
  const extract = require('tar-stream').extract()
  let result = Buffer.alloc(0)
  let found = false
  await new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      if (header.type !== 'file' || header.size > 2 * 1024 * 1024 || found) {
        extract.destroy(new Error('Unexpected proxy log archive'))
        return
      }
      found = true
      stream.on('data', (chunk) => {
        result = Buffer.concat([result, chunk]).subarray(-262144)
      })
      stream.on('end', next)
      stream.on('error', reject)
      stream.resume()
    })
    extract.on('finish', resolve)
    extract.on('error', reject)
    extract.end(stdout)
  })
  if (!found) throw new Error('Missing proxy log')
  return result.toString('utf8')
}
module.exports._private = { observations, readLog }
