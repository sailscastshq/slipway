const migrations = require('../../../api/lib/release-migrations')
migrations
  .run({
    directory: process.argv[2],
    beforeCommit({ service }) {
      if (service.datastore !== process.argv[3]) return
      process.stdout.write('transaction-ready\n')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000)
    }
  })
  .catch(() => {
    process.exitCode = 1
  })
