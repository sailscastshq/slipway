// Disposable Docker fixture: native release migrations and receipts without Sails jobs or host setup.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { execFileSync } = require('node:child_process')
const migrations = require('/app/api/lib/release-migrations')
const self = JSON.parse(
  execFileSync('docker', ['inspect', process.env.HOSTNAME], {
    encoding: 'utf8'
  })
)[0]
const preflight = self.Config.Labels?.['slipway.update.role'] === 'preflight'
const directory = '/app/db'
migrations
  .run({ directory, preflightOnly: preflight })
  .then((result) => {
    http
      .createServer((req, res) => {
        res.setHeader('Content-Type', 'application/json')
        const ready =
          !preflight &&
          Object.entries(migrations.files).every(([datastore, file]) =>
            migrations.current({ datastore, path: path.join(directory, file) })
          )
        res.end(
          JSON.stringify(
            preflight
              ? result
              : {
                  status: 'ok',
                  version: require('/app/package.json').version,
                  releaseMigrations: {
                    ready,
                    version: '0.0.88',
                    checksum: migrations.checksum
                  }
                }
          )
        )
      })
      .listen(Number(process.env.PORT) || 1337, '0.0.0.0')
  })
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
