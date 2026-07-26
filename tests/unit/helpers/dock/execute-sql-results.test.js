const fs = require('fs')
const os = require('os')
const path = require('path')

const { test } = require('sounding')
const { splitSqlStatements } = require('../../../../api/lib/dock-sql-results')

test('PostgreSQL queries return one labeled result per SQL statement', async ({
  sails,
  expect
}) => {
  await withFakeDocker(sails, async () => {
    const result = await sails.helpers.dock.executeSql.with({
      service: databaseService('postgresql'),
      query: [
        "SELECT 'alpha;beta' AS value;",
        'DROP TABLE temporary_items;',
        'SELECT count(*) AS total FROM creators;',
        'SELECT * FROM missing_items;'
      ].join('\n')
    })

    expect(result.success).toBe(false)
    expect(result.results.map((entry) => entry.status)).toEqual([
      'success',
      'success',
      'success',
      'error'
    ])
    expect(result.results[0]).toEqual({
      statementIndex: 0,
      statementSql: "SELECT 'alpha;beta' AS value;",
      statementPreview: "SELECT 'alpha;beta' AS value",
      commandTag: 'SELECT',
      status: 'success',
      duration: 1.25,
      rowCount: 1,
      affected: null,
      columns: ['value'],
      rows: [{ value: 'alpha;beta' }],
      message: null,
      error: null,
      sqlState: '00000',
      raw: 'value\nalpha;beta'
    })
    expect(result.results[1].commandTag).toBe('DROP TABLE')
    expect(result.results[1].message).toBe('DROP TABLE completed')
    expect(result.results[2].rows).toEqual([{ total: '24873' }])
    expect(result.results[3].statementIndex).toBe(3)
    expect(result.results[3].sqlState).toBe('42P01')
    expect(result.results[3].error).toBe(
      'relation "missing_items" does not exist'
    )
  })
})

test('MySQL queries preserve successful results before a later error', async ({
  sails,
  expect
}) => {
  await withFakeDocker(sails, async () => {
    const result = await sails.helpers.dock.executeSql.with({
      service: databaseService('mysql'),
      query: [
        "SELECT 'north;west' AS region;",
        'UPDATE creators SET active = 1 WHERE invited = 1;',
        'SELECT * FROM missing_items;'
      ].join('\n')
    })

    expect(result.success).toBe(false)
    expect(result.results.map((entry) => entry.status)).toEqual([
      'success',
      'success',
      'error'
    ])
    expect(result.results[0].columns).toEqual(['region'])
    expect(result.results[0].rows).toEqual([{ region: 'north;west' }])
    expect(result.results[1].commandTag).toBe('UPDATE')
    expect(result.results[1].affected).toBe(3)
    expect(result.results[1].message).toBe('UPDATE completed — 3 rows affected')
    expect(result.results[2].statementSql).toBe('SELECT * FROM missing_items;')
    expect(result.results[2].sqlState).toBe('42S02')
    expect(result.results[2].error).toBe(
      "Table 'app.missing_items' doesn't exist"
    )
  })
})

test('SQL statement boundaries ignore comments, strings, and dollar-quoted bodies', async ({
  sails,
  expect
}) => {
  await withFakeDocker(sails, async () => {
    const result = await sails.helpers.dock.executeSql.with({
      service: databaseService('postgresql'),
      query: [
        '-- the semicolon below belongs to the function body',
        'CREATE FUNCTION say_ready() RETURNS void AS $$',
        'BEGIN',
        "  PERFORM 'ready;still-ready';",
        'END;',
        '$$ LANGUAGE plpgsql;',
        "SELECT 'done;really' AS value;"
      ].join('\n')
    })

    expect(result.results.length).toBe(2)
    expect(result.results[0].commandTag).toBe('CREATE FUNCTION')
    expect(result.results[1].statementSql).toBe(
      "SELECT 'done;really' AS value;"
    )
  })
})

test('PostgreSQL escape strings cannot hide a following statement', async ({
  expect
}) => {
  const ordinaryString = splitSqlStatements(
    String.raw`SELECT 'x\'; DROP DATABASE slipway;`,
    'postgresql'
  )
  const escapeString = splitSqlStatements(
    String.raw`SELECT E'x\';still-a-string' AS value; SELECT 1;`,
    'postgresql'
  )

  expect(ordinaryString.map((statement) => statement.command)).toEqual([
    'SELECT',
    'DROP DATABASE'
  ])
  expect(escapeString.map((statement) => statement.command)).toEqual([
    'SELECT',
    'SELECT'
  ])
})

test('comment-only SQL returns a useful error without invoking Docker', async ({
  sails,
  expect
}) => {
  const result = await sails.helpers.dock.executeSql.with({
    service: databaseService('postgresql'),
    query: '-- explain the next query here'
  })

  expect(result.success).toBe(false)
  expect(result.results).toEqual([])
  expect(result.error).toBe('No executable SQL statements were found.')
})

async function withFakeDocker(sails, callback) {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'slipway-dock-results-')
  )
  const dockerPath = path.join(tempRoot, 'docker')
  const originalDockerPath = sails.config.docker?.binaryPath

  fs.writeFileSync(dockerPath, fakeDockerSource())
  fs.chmodSync(dockerPath, 0o755)
  sails.config.docker = sails.config.docker || {}
  sails.config.docker.binaryPath = dockerPath

  try {
    await callback()
  } finally {
    if (originalDockerPath === undefined) {
      delete sails.config.docker.binaryPath
    } else {
      sails.config.docker.binaryPath = originalDockerPath
    }
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

function databaseService(type) {
  return {
    type,
    containerName: `${type}-database`,
    username: 'slipway',
    password: 'secret',
    database: 'app'
  }
}

function fakeDockerSource() {
  return `#!/usr/bin/env node
const args = process.argv.slice(2)

if (args.includes('psql')) {
  let sqlState = '00000'
  let rowCount = '0'
  let lastError = ''

  for (let index = 0; index < args.length; index++) {
    if (args[index] !== '-c') continue
    const command = args[++index]

    if (command === '\\\\timing on') continue
    if (command.startsWith('\\\\echo ')) {
      console.log(
        command
          .slice(6)
          .replace(':SQLSTATE', sqlState)
          .replace(':ROW_COUNT', rowCount)
          .replace(':LAST_ERROR_MESSAGE', lastError)
      )
      continue
    }

    sqlState = '00000'
    rowCount = '0'
    if (command.includes("SELECT 'alpha;beta'")) {
      rowCount = '1'
      console.log('value')
      console.log('alpha;beta')
    } else if (command.startsWith('DROP TABLE')) {
      console.log('DROP TABLE')
    } else if (command.includes('count(*) AS total')) {
      rowCount = '1'
      console.log('total')
      console.log('24873')
    } else if (command.includes('missing_items')) {
      sqlState = '42P01'
      lastError = 'relation "missing_items" does not exist'
      console.error('ERROR:  relation "missing_items" does not exist')
    } else if (command.includes('CREATE FUNCTION')) {
      console.log('CREATE FUNCTION')
    } else if (command.includes("SELECT 'done;really'")) {
      rowCount = '1'
      console.log('value')
      console.log('done;really')
    }
    console.log('Time: 1.250 ms')
  }
  process.exit(0)
}

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  const marker = input.match(/(__SLIPWAY_RESULT_[a-f0-9]+__):start:0/)[1]
  const missingLine =
    input.split(/\\r?\\n/).findIndex((line) => line.includes('missing_items')) + 1

  function boundary(index, output, affected, duration) {
    console.log('__slipway_marker__')
    console.log(marker + ':start:' + index)
    if (output) console.log(output)
    console.log(
      '__slipway_marker__\\t__slipway_row_count__\\t__slipway_duration_ms__'
    )
    console.log(
      marker + ':end:' + index + '\\t' + affected + '\\t' + duration
    )
  }

  boundary(0, 'region\\nnorth;west', -1, 0.75)
  boundary(1, '', 3, 1.5)
  boundary(2, '', -1, 0.5)
  console.error(
    "ERROR 1146 (42S02) at line " +
      missingLine +
      ": Table 'app.missing_items' doesn't exist"
  )
})
`
}
