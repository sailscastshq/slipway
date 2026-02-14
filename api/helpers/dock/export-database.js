const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Export database',

  description: 'Export database tables as SQL dump.',

  inputs: {
    service: {
      type: 'ref',
      required: true,
      description: 'Database service object'
    },
    tables: {
      type: 'ref',
      description: 'Array of table names to export (empty = all tables)'
    },
    dataOnly: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Export data only (no schema)'
    },
    schemaOnly: {
      type: 'boolean',
      defaultsTo: false,
      description: 'Export schema only (no data)'
    }
  },

  exits: {
    success: {
      description: 'Export completed successfully',
      outputType: 'ref'
    },
    exportFailed: {
      description: 'Export failed'
    }
  },

  fn: async function ({ service, tables, dataOnly, schemaOnly }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const startTime = Date.now()

    let args
    let env = { ...process.env }

    if (service.type === 'postgresql') {
      // PostgreSQL: use pg_dump
      env.PGPASSWORD = service.password

      args = [
        'exec', '-i', service.containerName,
        'pg_dump',
        '-U', service.username,
        '-d', service.database,
        '--no-owner',
        '--no-acl'
      ]

      if (dataOnly) {
        args.push('--data-only')
      } else if (schemaOnly) {
        args.push('--schema-only')
      }

      // Add specific tables if provided
      if (tables && tables.length > 0) {
        for (const table of tables) {
          args.push('-t', table)
        }
      }
    } else if (service.type === 'mysql') {
      // MySQL: use mysqldump
      args = [
        'exec', '-i', service.containerName,
        'mysqldump',
        '-u', service.username,
        `-p${service.password}`,
        '--single-transaction',
        '--routines',
        '--triggers'
      ]

      if (dataOnly) {
        args.push('--no-create-info')
      } else if (schemaOnly) {
        args.push('--no-data')
      }

      // Database name
      args.push(service.database)

      // Add specific tables if provided
      if (tables && tables.length > 0) {
        args.push(...tables)
      }
    } else if (service.type === 'mongodb') {
      // MongoDB: use mongodump with JSON output
      // Note: schemaOnly doesn't apply to MongoDB (schemaless)
      const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`

      args = [
        'exec', '-i', service.containerName,
        'mongoexport',
        '--uri', mongoUri,
        '--jsonArray'
      ]

      // For MongoDB, we export one collection at a time
      // If specific tables (collections) provided, export first one
      // If no tables specified, we'll use mongodump for full database
      if (tables && tables.length > 0) {
        args.push('--collection', tables[0])
        // Note: mongoexport only exports one collection
        // For multiple collections, caller should make multiple requests
      } else {
        // Full database export - use mongodump instead
        args = [
          'exec', '-i', service.containerName,
          'mongodump',
          '--uri', mongoUri,
          '--archive',
          '--gzip'
        ]
      }
    } else {
      throw new Error(`Unsupported database type: ${service.type}`)
    }

    try {
      sails.log.verbose(`[dock] Exporting database from ${service.containerName}`)

      const { stdout, stderr } = await execFileAsync(dockerPath, args, {
        timeout: 300000, // 5 minute timeout for large exports
        maxBuffer: 100 * 1024 * 1024, // 100MB buffer
        env
      })

      const duration = Date.now() - startTime

      // Count approximate rows/statements for info
      const lines = stdout.split('\n').length
      const insertCount = (stdout.match(/INSERT INTO/gi) || []).length

      return {
        success: true,
        sql: stdout,
        size: stdout.length,
        lines,
        insertCount,
        duration
      }
    } catch (error) {
      sails.log.error(`[dock] Database export failed: ${error.message}`)

      let errorMessage = error.message
      if (error.stderr) {
        errorMessage = error.stderr.trim()
      }

      throw {
        exportFailed: {
          message: errorMessage
        }
      }
    }
  }
}
