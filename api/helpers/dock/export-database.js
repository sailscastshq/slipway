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
