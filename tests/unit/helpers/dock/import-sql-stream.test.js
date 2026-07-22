const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { test } = require('sounding')

test('a dump import passes a bounded file stream to the database process', async ({
  sails,
  expect
}) => {
  const tmpDirectory = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), 'slipway-import-test-')
  )
  const dumpPath = path.join(tmpDirectory, 'database.dmp')
  const dumpBytes = 2 * 1024 * 1024
  await writePostgresDump(dumpPath, dumpBytes)

  const originalRunProcess = sails.helpers.streams.runProcess
  const originalLimit = sails.config.custom.databaseOperations.sqlImportMaxBytes
  let streamedBytes = 0

  const consumeProcessInput = async ({ input, maxInputBytes }) => {
    expect(maxInputBytes).toBe(4 * 1024 * 1024)
    expect(Buffer.isBuffer(input)).toBe(false)
    for await (const chunk of input) streamedBytes += chunk.length
    return { stdout: '', stderr: '' }
  }
  consumeProcessInput.with = consumeProcessInput
  sails.helpers.streams.runProcess = consumeProcessInput
  sails.config.custom.databaseOperations.sqlImportMaxBytes = 4 * 1024 * 1024

  try {
    const result = await sails.helpers.dock.importSql.with({
      service: {
        type: 'postgresql',
        containerName: 'slipway-test-postgres',
        database: 'app',
        username: 'postgres',
        password: 'secret'
      },
      dumpPath
    })

    expect(streamedBytes).toBe(dumpBytes)
    expect(result.success).toBe(true)
  } finally {
    sails.helpers.streams.runProcess = originalRunProcess
    sails.config.custom.databaseOperations.sqlImportMaxBytes = originalLimit
    await fsPromises.rm(tmpDirectory, { recursive: true, force: true })
  }
})

async function writePostgresDump(filePath, bytes) {
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: 'wx' })
    output.once('error', reject)
    output.once('finish', resolve)
    output.write('PGDMP')

    const chunk = Buffer.alloc(64 * 1024)
    let remaining = bytes - 5
    while (remaining > 0) {
      const size = Math.min(remaining, chunk.length)
      output.write(chunk.subarray(0, size))
      remaining -= size
    }
    output.end()
  })
}
