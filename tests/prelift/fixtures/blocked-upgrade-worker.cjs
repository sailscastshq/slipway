const Database = require('better-sqlite3')
const fs = require('node:fs')
process.once('message', ({ input }) => {
  const db = new Database(input.filename)
  db.exec('BEGIN IMMEDIATE; ALTER TABLE notes ADD COLUMN added TEXT')
  if (input.commit) db.exec('COMMIT')
  fs.writeFileSync(input.started, String(process.pid))
  // Synchronous SQLite work cannot be interrupted by an in-process timer.
  db.prepare(
    'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n'
  ).get()
})
