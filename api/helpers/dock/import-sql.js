const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Import SQL',

  description: 'Import SQL statements into the database.',

  inputs: {
    service: {
      type: 'ref',
      required: true,
      description: 'Database service object'
    },
    sql: {
      type: 'string',
      description: 'SQL statements to import (text mode)'
    },
    dump: {
      type: 'ref',
      description: 'Binary dump buffer for pg_restore (binary mode)'
    }
  },

  exits: {
    success: {
      description: 'Import completed successfully',
      outputType: 'ref'
    },
    importFailed: {
      description: 'Import failed'
    }
  },

  fn: async function ({ service, sql, dump }) {
    if (!sql && !dump) {
      throw new Error('Either sql or dump must be provided')
    }

    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const startTime = Date.now()

    // Binary dump import (.dmp for PostgreSQL, .gz for MongoDB)
    if (dump) {
      const { spawn } = require('child_process')
      let args
      let tool

      if (service.type === 'postgresql') {
        tool = 'pg_restore'
        args = [
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
      } else if (service.type === 'mongodb') {
        tool = 'mongorestore'
        const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`
        args = [
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
      } else {
        throw new Error(
          `Binary dump import is not supported for ${service.type}`
        )
      }

      return new Promise((resolve, reject) => {
        const proc = spawn(dockerPath, args, { timeout: 300000 })
        let stderr = ''
        proc.stderr.on('data', (data) => {
          stderr += data.toString()
        })
        proc.on('close', (code) => {
          const duration = Date.now() - startTime
          if (code !== 0) {
            sails.log.error(
              `[dock] ${tool} failed with code ${code}: ${stderr}`
            )
            reject({
              importFailed: {
                message:
                  stderr.trim() || `${tool} failed with exit code ${code}`
              }
            })
          } else {
            resolve({
              success: true,
              message: 'Dump restored successfully',
              statementCount: 1,
              duration
            })
          }
        })
        proc.on('error', (err) => {
          reject({ importFailed: { message: err.message } })
        })
        proc.stdin.write(dump)
        proc.stdin.end()
      })
    }

    let args
    let env = { ...process.env }

    if (service.type === 'postgresql') {
      // PostgreSQL: pipe SQL to psql
      env.PGPASSWORD = service.password

      args = [
        'exec',
        '-i',
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
    } else if (service.type === 'mysql') {
      // MySQL: pipe SQL to mysql
      args = [
        'exec',
        '-i',
        service.containerName,
        'mysql',
        '-u',
        service.username,
        `-p${service.password}`,
        service.database
      ]
    } else if (service.type === 'mongodb') {
      // MongoDB: use mongoimport for JSON or mongorestore for archive
      const mongoUri = `mongodb://${service.username}:${service.password}@localhost:27017/${service.database}?authSource=admin`

      // Detect if input is JSON array (mongoexport format) or binary (mongodump archive)
      const trimmedSql = sql.trim()
      const isJsonArray =
        trimmedSql.startsWith('[') || trimmedSql.startsWith('{')

      if (isJsonArray) {
        // JSON import - need collection name from input or default
        // Look for collection hint in first line comment: // collection: users
        const collectionMatch = sql.match(/\/\/\s*collection:\s*(\w+)/)
        const collection = collectionMatch ? collectionMatch[1] : 'imported'

        args = [
          'exec',
          '-i',
          service.containerName,
          'mongoimport',
          '--uri',
          mongoUri,
          '--collection',
          collection,
          '--jsonArray',
          '--drop' // Replace existing collection
        ]
      } else {
        // Assume mongodump archive format
        args = [
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
    } else {
      throw new Error(`Unsupported database type: ${service.type}`)
    }

    try {
      sails.log.verbose(`[dock] Importing SQL into ${service.containerName}`)

      // Use spawn with stdin pipe for large SQL imports
      const { spawn } = require('child_process')

      return new Promise((resolve, reject) => {
        const proc = spawn(dockerPath, args, {
          timeout: 300000, // 5 minute timeout
          env
        })

        let stdout = ''
        let stderr = ''

        proc.stdout.on('data', (data) => {
          stdout += data.toString()
        })

        proc.stderr.on('data', (data) => {
          stderr += data.toString()
        })

        proc.on('close', (code) => {
          const duration = Date.now() - startTime

          if (code !== 0) {
            sails.log.error(
              `[dock] SQL import failed with code ${code}: ${stderr}`
            )
            reject({
              importFailed: {
                message: stderr.trim() || `Import failed with exit code ${code}`
              }
            })
          } else {
            // Count statements executed (rough estimate)
            const statementCount = (sql.match(/;\s*$/gm) || []).length

            resolve({
              success: true,
              message: stdout.trim() || 'Import completed successfully',
              statementCount,
              duration
            })
          }
        })

        proc.on('error', (error) => {
          reject({
            importFailed: {
              message: error.message
            }
          })
        })

        // Write SQL to stdin and close
        proc.stdin.write(sql)
        proc.stdin.end()
      })
    } catch (error) {
      sails.log.error(`[dock] SQL import failed: ${error.message}`)

      if (error.importFailed) {
        throw error
      }

      throw {
        importFailed: {
          message: error.message
        }
      }
    }
  }
}
