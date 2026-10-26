// Frozen snapshot implementation from c2667ee6f0391befbba54521eac93335ea5fb29e.
// Test-only baseline; never used by the application or operator commands.
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
function verify(db) {
  if (db.pragma('integrity_check', { simple: true }) !== 'ok')
    throw new Error('SQLite integrity check failed')
  if (db.pragma('foreign_key_check').length)
    throw new Error('SQLite foreign-key check failed')
}

async function snapshot(source, destination) {
  const db = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await db.backup(destination, {
      progress({ totalPages }) {
        const stats = fs.statfsSync(path.dirname(destination))
        if (Number(stats.bavail) * Number(stats.bsize) < 512 * 1024 * 1024)
          throw new Error(
            'Insufficient free disk space for a verified snapshot'
          )
        if (
          totalPages * db.pragma('page_size', { simple: true }) >
          50 * 1024 ** 3
        )
          throw new Error('Database snapshot exceeds the 50 GiB safety bound')
        return 200
      }
    })
  } finally {
    db.close()
  }
  const copy = new Database(destination, {
    readonly: true,
    fileMustExist: true
  })
  try {
    verify(copy)
  } finally {
    copy.close()
  }
  fs.chmodSync(destination, 0o600)
}

module.exports = { snapshot }
