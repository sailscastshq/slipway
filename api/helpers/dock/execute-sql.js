const crypto = require('crypto')
const { execFile, spawn } = require('child_process')
const util = require('util')
const {
  getStatementCommand,
  getStatementPreview,
  parseMysqlResults,
  parsePostgresResults,
  splitSqlStatements
} = require('../../lib/dock-sql-results')

const execFileAsync = util.promisify(execFile)
const maximumOutputBytes = 10 * 1024 * 1024
const queryTimeout = 30000

module.exports = {
  friendlyName: 'Execute SQL',

  description:
    'Execute a database query and return a labeled result for every statement.',

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
      description: 'Query execution completed',
      outputType: 'ref'
    }
  },

  fn: async function ({ service, query, format }) {
    const dockerPath = sails.config.docker?.binaryPath || 'docker'
    const startTime = Date.now()

    sails.log.verbose(`[dock] Executing query on ${service.containerName}`)

    try {
      if (service.type === 'postgresql') {
        return await executePostgres({
          dockerPath,
          service,
          query,
          startTime
        })
      }

      if (service.type === 'mysql') {
        return await executeMysql({
          dockerPath,
          service,
          query,
          startTime
        })
      }

      if (service.type === 'mongodb') {
        return await executeMongo({
          dockerPath,
          service,
          query,
          format,
          startTime
        })
      }

      throw new Error(`Unsupported database type: ${service.type}`)
    } catch (error) {
      sails.log.error(`[dock] Query execution failed: ${error.message}`)
      const duration = Date.now() - startTime
      const message = getProcessErrorMessage(error)
      const statement = {
        sql: query.trim(),
        command: getStatementCommand(query),
        preview: getStatementPreview(query)
      }
      const result = {
        statementIndex: 0,
        statementSql: statement.sql,
        statementPreview: statement.preview,
        commandTag: statement.command,
        status: 'error',
        duration,
        rowCount: 0,
        affected: null,
        columns: [],
        rows: [],
        message,
        error: message,
        raw: ''
      }

      return aggregateResults([result], duration, error.stderr)
    }
  }
}

async function executePostgres({ dockerPath, service, query, startTime }) {
  const statements = splitSqlStatements(query, 'postgresql')
  if (statements.length === 0) return noStatementsResult(startTime)

  const marker = createMarker()
  const args = [
    'exec',
    '-i',
    service.containerName,
    'psql',
    '-U',
    service.username,
    '-d',
    service.database,
    '--no-psqlrc',
    '--csv',
    '-v',
    'ON_ERROR_STOP=0',
    '-c',
    '\\timing on'
  ]

  statements.forEach((statement, index) => {
    args.push(
      '-c',
      `\\echo ${marker} START ${index}`,
      '-c',
      statement.sql,
      '-c',
      `\\echo ${marker} END ${index} :SQLSTATE :ROW_COUNT :LAST_ERROR_MESSAGE`
    )
  })

  let stdout = ''
  let stderr = ''
  let processError = null

  try {
    const output = await execFileAsync(dockerPath, args, {
      timeout: queryTimeout,
      maxBuffer: maximumOutputBytes,
      env: {
        ...process.env,
        PGPASSWORD: service.password
      }
    })
    stdout = output.stdout
    stderr = output.stderr
  } catch (error) {
    processError = error
    stdout = error.stdout || ''
    stderr = error.stderr || error.message
  }

  const duration = Date.now() - startTime
  const results = parsePostgresResults({
    stdout,
    stderr,
    statements,
    marker,
    totalDuration: duration
  })

  if (processError && results.every((result) => result.status === 'success')) {
    throw processError
  }

  return aggregateResults(results, duration, stderr)
}

async function executeMysql({ dockerPath, service, query, startTime }) {
  const statements = splitSqlStatements(query, 'mysql')
  if (statements.length === 0) return noStatementsResult(startTime)

  const marker = createMarker()
  const timerVariable = `slipway_${marker
    .replace(/[^A-Za-z0-9_]/g, '')
    .toLowerCase()}_started_at`
  const { payload, lineRanges } = buildMysqlPayload({
    statements,
    marker,
    timerVariable
  })
  const args = [
    'exec',
    '-i',
    service.containerName,
    'mysql',
    '-u',
    service.username,
    `-p${service.password}`,
    service.database,
    '--batch',
    '--force'
  ]

  let stdout = ''
  let stderr = ''
  let processError = null

  try {
    const output = await execFileWithInput(dockerPath, args, payload, {
      timeout: queryTimeout,
      maxBuffer: maximumOutputBytes
    })
    stdout = output.stdout
    stderr = output.stderr
  } catch (error) {
    processError = error
    stdout = error.stdout || ''
    stderr = error.stderr || error.message
  }

  const duration = Date.now() - startTime
  const results = parseMysqlResults({
    stdout,
    stderr,
    statements,
    marker,
    lineRanges,
    totalDuration: duration
  })

  if (processError && results.every((result) => result.status === 'success')) {
    throw processError
  }

  return aggregateResults(results, duration, stderr)
}

async function executeMongo({ dockerPath, service, query, format, startTime }) {
  const mongoUri = `mongodb://${encodeURIComponent(
    service.username
  )}:${encodeURIComponent(service.password)}@localhost:27017/${
    service.database
  }?authSource=admin`
  const wrappedQuery = `
    try {
      var result = ${query};
      print(JSON.stringify(result));
    } catch (e) {
      print(JSON.stringify({ __error: true, message: e.message }));
    }
  `.replace(/\n\s*/g, ' ')
  const { stdout, stderr } = await execFileAsync(
    dockerPath,
    [
      'exec',
      '-i',
      service.containerName,
      'mongosh',
      mongoUri,
      '--quiet',
      '--eval',
      wrappedQuery
    ],
    {
      timeout: queryTimeout,
      maxBuffer: maximumOutputBytes
    }
  )
  const parsed = parseMongoOutput(stdout, stderr, format)
  const duration = Date.now() - startTime
  const error = parsed.error || null
  const result = {
    statementIndex: 0,
    statementSql: query.trim(),
    statementPreview: getStatementPreview(query),
    commandTag: 'MONGODB',
    status: error ? 'error' : 'success',
    duration,
    rowCount: parsed.rowCount,
    affected: null,
    columns: parsed.columns,
    rows: parsed.rows,
    message: error || parsed.message || null,
    error,
    raw: stdout.trim()
  }

  return aggregateResults([result], duration, stderr)
}

function buildMysqlPayload({ statements, marker, timerVariable }) {
  const lines = []
  const lineRanges = []

  statements.forEach((statement, index) => {
    lines.push(`SET @${timerVariable} = NOW(6);`)
    lines.push(`SELECT '${marker}:start:${index}' AS __slipway_marker__;`)

    const statementLines = statement.sql.split(/\r?\n/)
    if (!statementLines.at(-1).trimEnd().endsWith(';')) {
      statementLines[statementLines.length - 1] += ';'
    }

    const start = lines.length + 1
    lines.push(...statementLines)
    const end = lines.length
    lineRanges.push({ start, end })

    lines.push(
      `SELECT '${marker}:end:${index}' AS __slipway_marker__, ROW_COUNT() AS __slipway_row_count__, ROUND(TIMESTAMPDIFF(MICROSECOND, @${timerVariable}, NOW(6)) / 1000, 3) AS __slipway_duration_ms__;`
    )
  })

  return {
    payload: `${lines.join('\n')}\n`,
    lineRanges
  }
}

function aggregateResults(results, duration, rawMessages = '') {
  const firstResult = results[0] || {
    columns: [],
    rows: [],
    rowCount: 0,
    message: 'Query executed successfully'
  }
  const failedResult = results.find((result) => result.status === 'error')
  const success = Boolean(results.length) && !failedResult

  return {
    success,
    ...firstResult,
    duration,
    results,
    error: failedResult?.error || undefined,
    messages: String(rawMessages || '').trim()
  }
}

function noStatementsResult(startTime) {
  const message = 'No executable SQL statements were found.'

  return {
    success: false,
    columns: [],
    rows: [],
    rowCount: 0,
    duration: Date.now() - startTime,
    results: [],
    error: message,
    message,
    messages: ''
  }
}

function createMarker() {
  return `__SLIPWAY_RESULT_${crypto.randomBytes(12).toString('hex')}__`
}

function getProcessErrorMessage(error) {
  return String(error.stderr || error.message || 'Query failed')
    .trim()
    .split(/\r?\n/)
    .pop()
}

function execFileWithInput(command, args, input, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let settled = false
    const timeout = setTimeout(() => {
      const error = new Error(`Query timed out after ${options.timeout}ms`)
      error.code = 'ETIMEDOUT'
      child.kill('SIGTERM')
      settle(error)
    }, options.timeout)

    function collect(chunk, stream) {
      outputBytes += chunk.length
      if (outputBytes > options.maxBuffer) {
        const error = new Error('Query output exceeded the 10MB limit')
        error.code = 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
        child.kill('SIGTERM')
        settle(error)
        return
      }

      if (stream === 'stdout') stdout += chunk.toString()
      else stderr += chunk.toString()
    }

    function settle(error) {
      if (settled) return
      settled = true
      clearTimeout(timeout)

      if (error) {
        error.stdout = stdout
        error.stderr = stderr || error.stderr
        reject(error)
      } else {
        resolve({ stdout, stderr })
      }
    }

    child.stdout.on('data', (chunk) => collect(chunk, 'stdout'))
    child.stderr.on('data', (chunk) => collect(chunk, 'stderr'))
    child.on('error', settle)
    child.on('close', (code, signal) => {
      if (code === 0) {
        settle()
        return
      }

      const error = new Error(
        signal
          ? `Database client stopped with signal ${signal}`
          : `Database client exited with code ${code}`
      )
      error.code = code
      error.signal = signal
      settle(error)
    })

    child.stdin.on('error', (error) => {
      if (error.code !== 'EPIPE') settle(error)
    })
    child.stdin.end(input)
  })
}

function parseMongoOutput(stdout) {
  const output = stdout.trim()

  if (!output) {
    return { columns: [], rows: [], rowCount: 0 }
  }

  try {
    const data = JSON.parse(output)

    if (data && data.__error) {
      return {
        message: data.message || 'MongoDB query failed',
        columns: [],
        rows: [],
        rowCount: 0,
        error: data.message
      }
    }

    if (Array.isArray(data)) {
      if (data.length === 0) {
        return { columns: [], rows: [], rowCount: 0 }
      }

      const columns = Array.from(
        new Set(data.flatMap((document) => Object.keys(document)))
      )
      const rows = data.map((document) => normalizeMongoDocument(document))
      return { columns, rows, rowCount: rows.length }
    }

    if (typeof data === 'object' && data !== null) {
      const row = normalizeMongoDocument(data)
      return {
        columns: Object.keys(row),
        rows: [row],
        rowCount: 1
      }
    }

    return {
      message: String(data),
      columns: [],
      rows: [],
      rowCount: 0
    }
  } catch {
    return {
      message: output,
      columns: [],
      rows: [],
      rowCount: 0
    }
  }
}

function normalizeMongoDocument(document) {
  const row = {}

  Object.entries(document).forEach(([column, value]) => {
    if (column === '_id' && value && typeof value === 'object') {
      row[column] = value.$oid || JSON.stringify(value)
    } else if (value && typeof value === 'object') {
      row[column] = JSON.stringify(value)
    } else {
      row[column] = value
    }
  })

  return row
}
