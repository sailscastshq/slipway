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
      required: true,
      description: 'SQL statements to import'
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

  fn: async function ({ service, sql }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const startTime = Date.now()

    let args
    let env = { ...process.env }

    if (service.type === 'postgresql') {
      // PostgreSQL: pipe SQL to psql
      env.PGPASSWORD = service.password

      args = [
        'exec', '-i', service.containerName,
        'psql',
        '-U', service.username,
        '-d', service.database,
        '--no-psqlrc',
        '-v', 'ON_ERROR_STOP=1'
      ]
    } else if (service.type === 'mysql') {
      // MySQL: pipe SQL to mysql
      args = [
        'exec', '-i', service.containerName,
        'mysql',
        '-u', service.username,
        `-p${service.password}`,
        service.database
      ]
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
            sails.log.error(`[dock] SQL import failed with code ${code}: ${stderr}`)
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
