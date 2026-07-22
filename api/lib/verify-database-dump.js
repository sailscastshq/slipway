const fs = require('node:fs/promises')

module.exports = async function verifyDatabaseDump(filePath, serviceType) {
  const file = await fs.open(filePath, 'r')
  const header = Buffer.alloc(5)

  try {
    await file.read(header, 0, header.length, 0)
  } finally {
    await file.close()
  }

  if (serviceType === 'postgresql' && header.toString('ascii') !== 'PGDMP') {
    throw new Error(
      'PostgreSQL dump has invalid header — expected PGDMP format'
    )
  }

  if (serviceType === 'mongodb' && (header[0] !== 0x1f || header[1] !== 0x8b)) {
    throw new Error('MongoDB dump has invalid header — expected gzip format')
  }
}
