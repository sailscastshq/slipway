const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const { Readable } = require('node:stream')

const verifyDatabaseDump = require('../../lib/verify-database-dump')

module.exports = {
  friendlyName: 'Import SQL',

  description: 'Stream SQL statements or a dump file into the database.',

  inputs: {
    service: {
      type: 'ref',
      required: true,
      description: 'Database service object.'
    },
    sql: {
      type: 'string',
      description: 'SQL statements to import in text mode.'
    },
    dumpPath: {
      type: 'string',
      description: 'Path to a binary dump file.'
    },
    signal: {
      type: 'ref',
      description: 'Optional AbortSignal.'
    }
  },

  exits: {
    success: {
      description: 'Import completed successfully.',
      outputType: 'ref'
    },
    importFailed: {
      description: 'Import failed.'
    }
  },

  fn: async function ({ service, sql, dumpPath, signal }) {
    if (!sql && !dumpPath) {
      throw new Error('Either sql or dumpPath must be provided')
    }

    const limits = sails.config.custom.databaseOperations
    const startTime = Date.now()

    try {
      let input
      let args
      let statementCount

      if (dumpPath) {
        const stats = await fsPromises.stat(dumpPath)
        if (stats.size === 0) throw new Error('Uploaded dump file is empty.')
        if (stats.size > limits.sqlImportMaxBytes) {
          throw new Error(
            `Uploaded dump exceeds the ${formatBytes(
              limits.sqlImportMaxBytes
            )} import limit.`
          )
        }

        await verifyDatabaseDump(dumpPath, service.type)
        input = fs.createReadStream(dumpPath)
        args = getBinaryImportArgs(service)
        statementCount = 1
      } else {
        const inputBytes = Buffer.byteLength(sql)
        if (inputBytes > limits.sqlImportMaxBytes) {
          throw new Error(
            `Data exceeds the ${formatBytes(
              limits.sqlImportMaxBytes
            )} import limit.`
          )
        }

        input = Readable.from([sql])
        args = getTextImportArgs(service, sql)
        statementCount = (sql.match(/;\s*$/gm) || []).length
      }

      sails.log.verbose(`[dock] Importing data into ${service.containerName}`)
      const result = await sails.helpers.streams.runProcess.with({
        command: sails.config.docker?.binaryPath || 'docker',
        args,
        input,
        timeoutMs: limits.sqlImportTimeoutMs,
        maxInputBytes: limits.sqlImportMaxBytes,
        maxOutputBytes: limits.maxProcessOutputBytes,
        maxStdoutBytes: limits.maxProcessOutputBytes,
        maxStderrBytes: limits.maxProcessStderrBytes,
        captureStdout: true,
        signal,
        killGraceMs: limits.killGraceMs
      })

      return {
        success: true,
        message:
          result.stdout.trim() ||
          (dumpPath
            ? 'Dump restored successfully'
            : 'Import completed successfully'),
        statementCount,
        duration: Date.now() - startTime
      }
    } catch (error) {
      const message = error.stderr?.trim() || error.message
      sails.log.error(`[dock] Database import failed: ${message}`)
      throw { importFailed: { message } }
    }
  }
}

function getBinaryImportArgs(service) {
  if (service.type === 'postgresql') {
    return [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${service.password}`,
      service.containerName,
      'pg_restore',
      '-U',
      service.username,
      '-d',
      service.database,
      '--no-owner',
      '--clean',
      '--if-exists'
    ]
  }

  if (service.type === 'mongodb') {
    const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`
    return [
      'exec',
      '-i',
      service.containerName,
      'mongorestore',
      '--uri',
      mongoUri,
      '--archive',
      '--gzip',
      '--drop'
    ]
  }

  throw new Error(`Binary dump import is not supported for ${service.type}`)
}

function getTextImportArgs(service, sql) {
  if (service.type === 'postgresql') {
    return [
      'exec',
      '-i',
      '-e',
      `PGPASSWORD=${service.password}`,
      service.containerName,
      'psql',
      '-U',
      service.username,
      '-d',
      service.database,
      '--no-psqlrc',
      '-v',
      'ON_ERROR_STOP=1'
    ]
  }

  if (service.type === 'mysql') {
    return [
      'exec',
      '-i',
      service.containerName,
      'mysql',
      '-u',
      service.username,
      `-p${service.password}`,
      service.database
    ]
  }

  if (service.type === 'mongodb') {
    const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`
    const trimmed = sql.trim()

    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      const collectionMatch = sql.match(/\/\/\s*collection:\s*(\w+)/)
      return [
        'exec',
        '-i',
        service.containerName,
        'mongoimport',
        '--uri',
        mongoUri,
        '--collection',
        collectionMatch ? collectionMatch[1] : 'imported',
        '--jsonArray',
        '--drop'
      ]
    }

    return [
      'exec',
      '-i',
      service.containerName,
      'mongorestore',
      '--uri',
      mongoUri,
      '--archive',
      '--gzip',
      '--drop'
    ]
  }

  throw new Error(`Unsupported database type: ${service.type}`)
}

function formatBytes(bytes) {
  return `${Math.round(bytes / (1024 * 1024))} MB`
}
