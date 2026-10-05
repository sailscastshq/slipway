const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const files = ['app.db', 'observability.db', 'analytics.db', 'stash.db']
function fail() {
  throw Object.assign(
    new Error('Fresh initialization requires unused storage.'),
    { code: 'upgradeHostTarget' }
  )
}
module.exports = function prepareFreshStorage(directory) {
  const root = fs.realpathSync(directory)
  if (fs.readdirSync(root).some((name) => !files.includes(name))) fail()
  // Validate every existing file before creating a missing one. Partial
  // initialization is resumable; existing catalogs and secrets are never reset.
  for (const filename of fs.readdirSync(root)) {
    const target = path.join(root, filename)
    const stat = fs.lstatSync(target)
    if (!stat.isFile() || stat.isSymbolicLink()) fail()
    const db = new Database(target, { readonly: true, fileMustExist: true })
    try {
      if (
        db
          .prepare(
            "SELECT count(*) AS n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'"
          )
          .get().n
      )
        fail()
    } finally {
      db.close()
    }
  }
  for (const filename of files) {
    const target = path.join(root, filename)
    if (!fs.existsSync(target)) fs.closeSync(fs.openSync(target, 'wx', 0o600))
  }
  return root
}
