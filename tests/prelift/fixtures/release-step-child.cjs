const migrations = require('../../../api/lib/release-migrations')
migrations
  .run({
    directory: process.argv[2],
    beforeCommit({ service, database }) {
      if (service.datastore !== process.argv[3]) return
      database.pragma('cache_size = 10')
      database
        .prepare(
          "UPDATE restart_marker SET value='uncommitted', payload=zeroblob(1048576)"
        )
        .run()
      process.stdout.write('transaction-ready\n')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
    }
  })
  .catch(() => {
    process.exitCode = 1
  })
