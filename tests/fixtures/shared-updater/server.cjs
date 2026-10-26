// Disposable Docker fixture: native release migrations and receipts without Sails jobs or host setup.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const migrations = require('/app/api/lib/release-migrations')
const startup = require('/app/api/lib/release-startup')
const directory = '/app/db'
startup
  .beforeLift({ directory })
  .then((normalStartup) => {
    if (!normalStartup) return
    if (process.env.UPDATER_PROOF_FAIL === '1')
      throw new Error('Fixture candidate failed after migration preflight')
    http
      .createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const ready =
          normalStartup &&
          Object.entries(migrations.files).every(([datastore, file]) =>
            migrations.current({ datastore, path: path.join(directory, file) })
          )
        res.end(
          JSON.stringify({
            status: 'ok',
            version: require('/app/package.json').version,
            releaseMigrations: {
              ready,
              version: '0.0.88',
              checksum: migrations.checksum
            }
          })
        )
      })
      .listen(Number(process.env.PORT) || 1337, '0.0.0.0')
  })
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
