const Database = require('better-sqlite3')
const fs = require('node:fs')
const db = new Database(process.argv[2])
db.pragma('journal_mode = WAL')
db.exec(
  'CREATE TABLE IF NOT EXISTS writer_receipts(id INTEGER PRIMARY KEY); INSERT INTO writer_receipts DEFAULT VALUES'
)
fs.writeFileSync(process.argv[3], String(process.pid))
setInterval(() => db.exec('INSERT INTO writer_receipts DEFAULT VALUES'), 50)
