const { execFile } = require('child_process')
const util = require('util')
const execFileAsync = util.promisify(execFile)

module.exports = {
  friendlyName: 'Execute SQL',

  description: 'Execute a SQL query against a database service via docker exec.',

  inputs: {
    service: {
      type: 'ref',
      required: true,
      description: 'Database service object'
    },
    query: {
      type: 'string',
      required: true,
      description: 'SQL query to execute'
    },
    format: {
      type: 'string',
      defaultsTo: 'json',
      isIn: ['json', 'table', 'raw'],
      description: 'Output format'
    }
  },

  exits: {
    success: {
      description: 'Query executed successfully',
      outputType: 'ref'
    },
    queryFailed: {
      description: 'Query execution failed'
    }
  },

  fn: async function ({ service, query, format }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const startTime = Date.now()

    let args
    let parseOutput

    if (service.type === 'postgresql') {
      // PostgreSQL: use psql with CSV output for reliable parsing
      args = [
        'exec', '-i', service.containerName,
        'psql',
        '-U', service.username,
        '-d', service.database,
        '-c', query,
        '--no-psqlrc',
        '--csv'
      ]

      parseOutput = (stdout, stderr) => parsePostgresOutput(stdout, stderr, format)
    } else if (service.type === 'mysql') {
      // MySQL: use mysql client
      args = [
        'exec', '-i', service.containerName,
        'mysql',
        '-u', service.username,
        `-p${service.password}`,
        service.database,
        '-e', query
      ]

      if (format === 'json') {
        args.push('--batch') // Tab-separated output
      }

      parseOutput = (stdout, stderr) => parseMysqlOutput(stdout, stderr, format)
    } else {
      throw new Error(`Unsupported database type: ${service.type}`)
    }

    try {
      sails.log.verbose(`[dock] Executing SQL on ${service.containerName}`)

      const { stdout, stderr } = await execFileAsync(dockerPath, args, {
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large results
        env: {
          ...process.env,
          PGPASSWORD: service.password // PostgreSQL password via env
        }
      })

      const duration = Date.now() - startTime

      const result = parseOutput(stdout, stderr)

      return {
        success: true,
        ...result,
        duration
      }
    } catch (error) {
      sails.log.error(`[dock] SQL execution failed: ${error.message}`)

      // Extract useful error message
      let errorMessage = error.message
      if (error.stderr) {
        errorMessage = error.stderr.trim()
      }

      return {
        success: false,
        error: errorMessage,
        duration: Date.now() - startTime
      }
    }
  }
}

/**
 * Parse PostgreSQL CSV output into structured format
 */
function parsePostgresOutput(stdout, stderr, format) {
  const output = stdout.trim()

  if (!output) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  // Check for non-SELECT queries (INSERT, UPDATE, DELETE)
  // Use word boundary \b to avoid matching column names like "created_at"
  if (output.match(/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i)) {
    return {
      message: output,
      columns: [],
      rows: [],
      rowCount: 0
    }
  }

  // Parse CSV output (--csv flag)
  // Handle both \n and \r\n line endings
  const lines = output.split(/\r?\n/).filter(line => line.length > 0)

  if (lines.length === 0) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  // First line is headers - trim any whitespace/carriage returns
  const headerLine = lines[0].trim()

  if (!headerLine) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  // Check if this looks like CSV (contains commas)
  if (!headerLine.includes(',')) {
    // Single column or non-CSV output
    if (headerLine.match(/^[a-z_][a-z0-9_]*$/i)) {
      // Looks like a single column name
      return {
        columns: [headerLine],
        rows: lines.slice(1).filter(l => l.trim()).map(l => ({ [headerLine]: l.trim() || null })),
        rowCount: lines.length - 1
      }
    }
    // Not CSV format - return as message
    return {
      message: output,
      columns: [],
      rows: [],
      rowCount: 0
    }
  }

  const columns = parseCSVLine(headerLine)

  if (columns.length === 0) {
    return {
      message: output,
      columns: [],
      rows: [],
      rowCount: 0
    }
  }

  // Rest are data rows
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const values = parseCSVLine(line)
    const row = {}
    columns.forEach((col, idx) => {
      const val = values[idx]
      // Handle empty strings as null for consistency
      row[col] = val === '' ? null : val
    })
    rows.push(row)
  }

  return {
    columns,
    rows,
    rowCount: rows.length
  }
}

/**
 * Parse a single CSV line, handling quoted fields
 */
function parseCSVLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        current += '"'
        i++
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        // Start of quoted field
        inQuotes = true
      } else if (char === ',') {
        // Field separator
        result.push(current)
        current = ''
      } else {
        current += char
      }
    }
  }

  // Don't forget the last field
  result.push(current)

  return result
}

/**
 * Parse MySQL output into structured format
 */
function parseMysqlOutput(stdout, stderr, format) {
  const output = stdout.trim()

  if (!output) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  // Check for non-SELECT queries
  if (output.match(/^Query OK/)) {
    return {
      message: output,
      columns: [],
      rows: [],
      rowCount: 0
    }
  }

  // Parse tab-separated output (--batch mode)
  const lines = output.split('\n').filter(line => line.trim())

  if (lines.length === 0) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  // First line is headers
  const columns = lines[0].split('\t')
  const rows = lines.slice(1).map(line => {
    const values = line.split('\t')
    const row = {}
    columns.forEach((col, i) => {
      row[col] = values[i] === 'NULL' ? null : values[i]
    })
    return row
  })

  return {
    columns,
    rows,
    rowCount: rows.length
  }
}
