function splitSqlStatements(sql, dialect = 'postgresql') {
  const statements = []
  let buffer = ''
  let state = 'normal'
  let blockCommentDepth = 0
  let dollarQuote = null
  let quoteUsesBackslashEscapes = false

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index]
    const nextCharacter = sql[index + 1]
    buffer += character

    if (state === 'line-comment') {
      if (character === '\n') state = 'normal'
      continue
    }

    if (state === 'block-comment') {
      if (character === '/' && nextCharacter === '*') {
        blockCommentDepth++
        buffer += nextCharacter
        index++
      } else if (character === '*' && nextCharacter === '/') {
        blockCommentDepth--
        buffer += nextCharacter
        index++
        if (blockCommentDepth === 0) state = 'normal'
      }
      continue
    }

    if (state === 'single-quote') {
      if (character === "'" && nextCharacter === "'") {
        buffer += nextCharacter
        index++
      } else if (
        character === "'" &&
        (!quoteUsesBackslashEscapes || !isBackslashEscaped(sql, index))
      ) {
        state = 'normal'
      }
      continue
    }

    if (state === 'double-quote') {
      if (character === '"' && nextCharacter === '"') {
        buffer += nextCharacter
        index++
      } else if (
        character === '"' &&
        (!quoteUsesBackslashEscapes || !isBackslashEscaped(sql, index))
      ) {
        state = 'normal'
      }
      continue
    }

    if (state === 'backtick') {
      if (character === '`' && nextCharacter === '`') {
        buffer += nextCharacter
        index++
      } else if (character === '`') {
        state = 'normal'
      }
      continue
    }

    if (state === 'dollar-quote') {
      if (sql.startsWith(dollarQuote, index)) {
        buffer += dollarQuote.slice(1)
        index += dollarQuote.length - 1
        dollarQuote = null
        state = 'normal'
      }
      continue
    }

    if (character === '-' && nextCharacter === '-') {
      state = 'line-comment'
      buffer += nextCharacter
      index++
      continue
    }

    if (dialect === 'mysql' && character === '#') {
      state = 'line-comment'
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      state = 'block-comment'
      blockCommentDepth = 1
      buffer += nextCharacter
      index++
      continue
    }

    if (character === "'") {
      state = 'single-quote'
      quoteUsesBackslashEscapes =
        dialect === 'mysql' || hasPostgresEscapeStringPrefix(sql, index)
      continue
    }

    if (character === '"') {
      state = 'double-quote'
      quoteUsesBackslashEscapes = dialect === 'mysql'
      continue
    }

    if (character === '`') {
      state = 'backtick'
      continue
    }

    if (dialect === 'postgresql' && character === '$') {
      const match = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (match) {
        dollarQuote = match[0]
        state = 'dollar-quote'
        buffer += dollarQuote.slice(1)
        index += dollarQuote.length - 1
        continue
      }
    }

    if (character === ';') {
      pushStatement(statements, buffer)
      buffer = ''
    }
  }

  pushStatement(statements, buffer)
  return statements
}

function pushStatement(statements, sql) {
  const statementSql = sql.trim()
  if (!statementSql || !stripSqlComments(statementSql).trim()) return

  statements.push({
    sql: statementSql,
    command: getStatementCommand(statementSql),
    preview: getStatementPreview(statementSql)
  })
}

function stripSqlComments(sql) {
  let index = 0

  while (index < sql.length) {
    while (/\s/.test(sql[index] || '')) index++

    if (sql.startsWith('--', index) || sql[index] === '#') {
      const lineEnd = sql.indexOf('\n', index)
      index = lineEnd === -1 ? sql.length : lineEnd + 1
      continue
    }

    if (sql.startsWith('/*', index)) {
      let depth = 1
      index += 2

      while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
          depth++
          index += 2
        } else if (sql.startsWith('*/', index)) {
          depth--
          index += 2
        } else {
          index++
        }
      }
      continue
    }

    break
  }

  return sql.slice(index).trim()
}

function getStatementCommand(sql) {
  const statement = stripSqlComments(sql)
  const words = statement.match(/^[A-Za-z]+(?:\s+[A-Za-z]+)?/)
  if (!words) return 'SQL'

  const [firstWord, secondWord] = words[0].toUpperCase().split(/\s+/)
  if (
    secondWord &&
    ['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'GRANT', 'REVOKE'].includes(
      firstWord
    )
  ) {
    return `${firstWord} ${secondWord}`
  }

  return firstWord
}

function getStatementPreview(sql, maximumLength = 72) {
  const preview = stripSqlComments(sql)
    .replace(/;\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (preview.length <= maximumLength) return preview
  return `${preview.slice(0, maximumLength - 1).trimEnd()}…`
}

function isBackslashEscaped(sql, index) {
  let backslashes = 0
  for (let cursor = index - 1; cursor >= 0 && sql[cursor] === '\\'; cursor--) {
    backslashes++
  }
  return backslashes % 2 === 1
}

function hasPostgresEscapeStringPrefix(sql, quoteIndex) {
  const prefix = sql[quoteIndex - 1]
  const beforePrefix = sql[quoteIndex - 2]
  return (
    (prefix === 'E' || prefix === 'e') &&
    (!beforePrefix || !/[A-Za-z0-9_$]/.test(beforePrefix))
  )
}

function parseCsvRecords(csv) {
  const records = []
  let record = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < csv.length; index++) {
    const character = csv[index]
    const nextCharacter = csv[index + 1]

    if (inQuotes) {
      if (character === '"' && nextCharacter === '"') {
        field += '"'
        index++
      } else if (character === '"') {
        inQuotes = false
      } else {
        field += character
      }
      continue
    }

    if (character === '"') {
      inQuotes = true
    } else if (character === ',') {
      record.push(field)
      field = ''
    } else if (character === '\n') {
      record.push(field.replace(/\r$/, ''))
      records.push(record)
      record = []
      field = ''
    } else {
      field += character
    }
  }

  if (field || record.length) {
    record.push(field.replace(/\r$/, ''))
    records.push(record)
  }

  return records.filter(
    (recordValues) =>
      recordValues.length > 1 || (recordValues[0] || '').length > 0
  )
}

function rowsFromRecords(records) {
  if (records.length === 0) return { columns: [], rows: [] }

  const columns = records[0]
  const rows = records.slice(1).map((values) => {
    const row = {}
    columns.forEach((column, index) => {
      row[column] =
        values[index] === undefined || values[index] === ''
          ? null
          : values[index]
    })
    return row
  })

  return { columns, rows }
}

function parsePostgresResults({
  stdout,
  stderr,
  statements,
  marker,
  totalDuration
}) {
  const results = []

  for (let index = 0; index < statements.length; index++) {
    const startMarker = `${marker} START ${index}`
    const endMarker = `${marker} END ${index} `
    const start = stdout.indexOf(startMarker)
    const end = stdout.indexOf(endMarker, Math.max(0, start))

    if (start === -1 || end === -1) {
      results.push(
        createIncompleteResult(statements[index], index, stderr, totalDuration)
      )
      continue
    }

    const outputStart = start + startMarker.length
    const rawOutput = stdout
      .slice(outputStart, end)
      .replace(/^\r?\n/, '')
      .trim()
    const endOfLine = stdout.indexOf('\n', end)
    const endLine = stdout.slice(
      end,
      endOfLine === -1 ? stdout.length : endOfLine
    )
    const metadata = endLine.slice(endMarker.length).trim()
    const [sqlState = '00000', rowCountValue = '0', ...messageParts] =
      metadata.split(' ')
    const error = sqlState === '00000' ? null : messageParts.join(' ').trim()
    const timing = rawOutput.match(
      /(?:^|\r?\n)Time:\s+([0-9.]+)\s+ms(?:\s+\([^)]+\))?\s*$/i
    )
    const duration = timing ? Number(timing[1]) : null
    const output = timing
      ? rawOutput.slice(0, timing.index).trim()
      : rawOutput.trim()
    const commandTag = isPostgresCommandTag(output) ? output : null
    const parsed = commandTag
      ? { columns: [], rows: [] }
      : rowsFromRecords(parseCsvRecords(output))
    const reportedRowCount = Number.parseInt(rowCountValue, 10)
    const rowCount = parsed.columns.length
      ? parsed.rows.length
      : Number.isFinite(reportedRowCount)
      ? reportedRowCount
      : 0
    const status = error ? 'error' : 'success'

    results.push({
      statementIndex: index,
      statementSql: statements[index].sql,
      statementPreview: statements[index].preview,
      commandTag: commandTag || statements[index].command,
      status,
      duration,
      rowCount,
      affected:
        !parsed.columns.length && reportsAffectedRows(statements[index].command)
          ? rowCount
          : null,
      columns: parsed.columns,
      rows: parsed.rows,
      message:
        error || formatCommandMessage(statements[index].command, rowCount),
      error,
      sqlState,
      raw: output
    })
  }

  return results
}

function parseMysqlResults({
  stdout,
  stderr,
  statements,
  marker,
  lineRanges,
  totalDuration
}) {
  const lines = stdout.split(/\r?\n/)
  const errors = parseMysqlErrors(stderr, lineRanges)

  return statements.map((statement, index) => {
    const startValue = `${marker}:start:${index}`
    const endValue = `${marker}:end:${index}`
    const startLine = lines.indexOf(startValue)
    const endLine = lines.findIndex((line) => line.startsWith(`${endValue}\t`))
    const statementError = errors.get(index) || null

    if (startLine === -1 || endLine === -1 || endLine <= startLine) {
      return createIncompleteResult(
        statement,
        index,
        statementError?.message || stderr,
        totalDuration
      )
    }

    const metadata = lines[endLine].split('\t')
    const affectedValue = Number.parseInt(metadata[1], 10)
    const durationValue = Number.parseFloat(metadata[2])
    const markerHeaderIndex = endLine - 1
    const outputLines = lines
      .slice(startLine + 1, markerHeaderIndex)
      .filter((line) => line.length > 0)
    const columns = outputLines.length ? outputLines[0].split('\t') : []
    const rows = outputLines.slice(1).map((line) => {
      const values = line.split('\t')
      const row = {}
      columns.forEach((column, valueIndex) => {
        row[column] =
          values[valueIndex] === 'NULL'
            ? null
            : decodeMysqlBatchValue(values[valueIndex])
      })
      return row
    })
    const rowCount = columns.length
      ? rows.length
      : Number.isFinite(affectedValue) && affectedValue > 0
      ? affectedValue
      : 0
    const error = statementError?.message || null

    return {
      statementIndex: index,
      statementSql: statement.sql,
      statementPreview: statement.preview,
      commandTag: statement.command,
      status: error ? 'error' : 'success',
      duration: Number.isFinite(durationValue) ? durationValue : null,
      rowCount,
      affected:
        !columns.length && reportsAffectedRows(statement.command)
          ? Math.max(0, affectedValue || 0)
          : null,
      columns,
      rows,
      message: error || formatCommandMessage(statement.command, rowCount),
      error,
      sqlState: statementError?.sqlState || '00000',
      raw: outputLines.join('\n')
    }
  })
}

function parseMysqlErrors(stderr, lineRanges) {
  const errors = new Map()
  const pattern = /ERROR\s+(\d+)\s+\(([^)]+)\)\s+at line\s+(\d+):\s*([^\n]+)/g
  let match

  while ((match = pattern.exec(stderr))) {
    const line = Number.parseInt(match[3], 10)
    const statementIndex = lineRanges.findIndex(
      (range) => line >= range.start && line <= range.end
    )
    if (statementIndex === -1) continue

    errors.set(statementIndex, {
      code: match[1],
      sqlState: match[2],
      message: match[4].trim()
    })
  }

  return errors
}

function decodeMysqlBatchValue(value = '') {
  return value.replace(/\\([0nt\\])/g, (match, character) => {
    if (character === '0') return '\0'
    if (character === 'n') return '\n'
    if (character === 't') return '\t'
    return '\\'
  })
}

function isPostgresCommandTag(output) {
  return /^(?:INSERT\s+\d+\s+\d+|UPDATE\s+\d+|DELETE\s+\d+|MERGE\s+\d+|SELECT\s+\d+|COPY\s+\d+|CREATE(?:\s+[A-Z]+)?|ALTER(?:\s+[A-Z]+)?|DROP(?:\s+[A-Z]+)?|TRUNCATE(?:\s+[A-Z]+)?|GRANT|REVOKE|COMMENT|VACUUM|ANALYZE|BEGIN|COMMIT|ROLLBACK|SET|RESET|DO)(?:\r?\n.*)?$/i.test(
    output
  )
}

function formatCommandMessage(command, affected) {
  if (command === 'SELECT' || command === 'WITH' || command === 'SHOW') {
    return null
  }

  if (
    Number.isFinite(affected) &&
    affected > 0 &&
    ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY'].includes(command)
  ) {
    return `${command} completed — ${affected} row${
      affected === 1 ? '' : 's'
    } affected`
  }

  return `${command} completed`
}

function reportsAffectedRows(command) {
  return ['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'COPY'].includes(command)
}

function createIncompleteResult(
  statement,
  statementIndex,
  error,
  totalDuration
) {
  const message = String(
    error || 'The database client did not return a result.'
  )
    .trim()
    .split(/\r?\n/)
    .pop()

  return {
    statementIndex,
    statementSql: statement.sql,
    statementPreview: statement.preview,
    commandTag: statement.command,
    status: 'error',
    duration: Number.isFinite(totalDuration) ? totalDuration : null,
    rowCount: 0,
    affected: null,
    columns: [],
    rows: [],
    message,
    error: message,
    raw: ''
  }
}

module.exports = {
  getStatementCommand,
  getStatementPreview,
  parseMysqlResults,
  parsePostgresResults,
  splitSqlStatements
}
