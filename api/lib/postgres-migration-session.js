const { spawn } = require('node:child_process')
const { randomBytes } = require('node:crypto')
const {
  splitSqlStatements,
  parsePostgresResults
} = require('./dock-sql-results')

module.exports = function postgresMigrationSession(service) {
  const child = spawn(
    sails.config.docker?.binaryPath || 'docker',
    [
      'exec',
      '-i',
      '-e',
      'PGPASSWORD',
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
      '-P',
      'pager=off'
    ],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGPASSWORD: service.password || '' }
    }
  )
  let pending = null,
    closed = false
  const lifetime = setTimeout(() => child.kill('SIGKILL'), 180000)
  const fail = () => {
    closed = true
    clearTimeout(lifetime)
    if (pending) {
      clearTimeout(pending.timer)
      pending.reject(
        new Error('The database session ended before its result was confirmed.')
      )
      pending = null
    }
  }
  child.on('error', fail)
  child.on('close', fail)
  child.stdin.on('error', fail)
  child.stderr.on('data', (chunk) => {
    if (pending) collect('stderr', chunk)
  })
  child.stdout.on('data', (chunk) => {
    if (!pending) return
    collect('stdout', chunk)
    if (!pending || !pending.stdout.includes(`${pending.marker} DONE\n`)) return
    const completed = pending
    pending = null
    clearTimeout(completed.timer)
    const results = parsePostgresResults({
      stdout: completed.stdout,
      stderr: completed.stderr,
      statements: completed.statements,
      marker: completed.marker,
      totalDuration: Date.now() - completed.started
    })
    const error = results.find((result) => result.status !== 'success')
    const last = results.at(-1)
    completed.resolve({
      success: !error,
      results,
      rows: last?.rows || [],
      columns: last?.columns || [],
      error: error?.error || error?.message,
      rowCount: last?.rowCount || 0
    })
  })
  function collect(stream, chunk) {
    pending[stream] += chunk.toString()
    if (pending.stdout.length + pending.stderr.length > 10 * 1024 * 1024) {
      child.kill('SIGKILL')
      fail()
    }
  }
  return {
    query(sql) {
      if (closed || pending)
        return Promise.reject(
          new Error('The migration session is unavailable.')
        )
      const statements = splitSqlStatements(sql, 'postgresql')
      const marker = '__SLIPWAY_MIGRATION_' + randomBytes(16).toString('hex')
      const payload =
        statements
          .map(
            (statement, index) =>
              `\\echo ${marker} START ${index}\n${statement.sql};\n\\echo ${marker} END ${index} :SQLSTATE :ROW_COUNT :LAST_ERROR_MESSAGE\n`
          )
          .join('') + `\\echo ${marker} DONE\n`
      return new Promise((resolve, reject) => {
        pending = {
          resolve,
          reject,
          statements,
          marker,
          stdout: '',
          stderr: '',
          started: Date.now(),
          timer: setTimeout(() => {
            child.kill('SIGKILL')
            fail()
          }, 35000)
        }
        child.stdin.write(payload)
      })
    },
    close() {
      clearTimeout(lifetime)
      child.stdin.end('\\q\n')
    }
  }
}
