const Database = require('better-sqlite3')
const db = new Database('/app/db/session.db')
db.exec(
  'CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY, value TEXT)'
)
setInterval(
  () =>
    db
      .prepare('INSERT INTO sessions(value) VALUES (?)')
      .run('synthetic-existing-session'),
  200
)
