/**
 * Controlled schema-inventory benchmark. Uses the real helper and SQL splitter
 * with a deterministic catalog transport; never queries an existing database.
 * Transport latency is injected, not a claim about production wall-clock time.
 * CATALOG_HELPER may point to the previous revision for identical before/after
 * inputs. CATALOG_LATENCY_MS=0 isolates local JS processing.
 */
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const path = require('node:path')
const { performance } = require('node:perf_hooks')
const {
  schemaCatalogFixture
} = require('../tests/support/schema-catalog-fixture')
const helper = require(process.env.CATALOG_HELPER ||
  path.join(__dirname, '../api/helpers/dock/get-schema'))
const latencyMs = Number(process.env.CATALOG_LATENCY_MS || 10)
const samples = Number(process.env.CATALOG_SAMPLES || 15)
const tableCount = Number(process.env.CATALOG_TABLES || 40)

async function main() {
  for (const type of ['postgresql', 'mysql']) {
    const timings = []
    let calls, schemaHash
    for (let i = 0; i < samples + 1; i++) {
      const fixture = schemaCatalogFixture({ type, tableCount })
      global.sails = {
        helpers: {
          dock: {
            executeSql: (service, query) =>
              fixture.executeSql(service, query, latencyMs)
          }
        }
      }
      const started = performance.now()
      const result = await helper.fn({ service: { type } })
      const elapsed = performance.now() - started
      assert.equal(result.error, undefined)
      assert.equal(Object.keys(result.tables).length, tableCount)
      calls = fixture.calls.length
      schemaHash = createHash('sha256')
        .update(JSON.stringify(result.tables))
        .digest('hex')
      if (i) timings.push(elapsed)
    }
    timings.sort((a, b) => a - b)
    console.log(
      JSON.stringify({
        type,
        tableCount,
        columnsPerTable: 20,
        samples,
        injectedLatencyMs: latencyMs,
        calls,
        p50Ms: +timings[Math.floor(samples * 0.5)].toFixed(2),
        p95Ms:
          +timings[Math.min(samples - 1, Math.floor(samples * 0.95))].toFixed(
            2
          ),
        schemaHash
      })
    )
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
