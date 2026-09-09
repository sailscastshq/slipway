const { execFile, spawn } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID, createHash } = require('node:crypto')
const { quoteIdentifier } = require('../../lib/native-migration-contract')
const exec = promisify(execFile)
let active = false

module.exports = {
  friendlyName: 'Preflight native migration',
  description:
    'Validate current rows and execute the plan against an isolated copy of the exact database engine and native schema.',
  inputs: {
    service: { type: 'ref', required: true },
    statements: { type: 'ref', required: true },
    schema: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ service, statements, schema }) {
    if (!statements.length || statements.some((item) => item.blocked))
      return { verified: false, statements }
    if (active)
      return blocked(
        'Another native migration preview is being checked. Retry shortly.'
      )
    active = true
    const docker = sails.config.docker?.binaryPath || 'docker'
    const name = `slipway-migration-preview-${randomUUID()}`
    const pg = service.type === 'postgresql'
    const password = randomUUID()
    const fixture = {
      type: service.type,
      containerName: name,
      username: pg ? 'postgres' : 'root',
      password,
      database: pg ? 'postgres' : 'fixture'
    }
    const counts = {}
    const started = Date.now()
    try {
      if (!['postgresql', 'mysql'].includes(service.type))
        throw new Error('Unsupported preflight engine.')
      const inspection = JSON.parse(
        (
          await exec(docker, ['inspect', service.containerName], {
            timeout: 5000,
            maxBuffer: 1024 * 1024
          })
        ).stdout
      )[0]
      if (!inspection?.Image || !inspection.State?.Running)
        throw new Error('The target database must be running.')
      for (const table of new Set(
        statements.map((item) => item.table).filter((table) => schema[table])
      )) {
        const result = await sails.helpers.dock.executeSql(
          service,
          `SELECT COUNT(*) AS count FROM ${quoteIdentifier(
            table,
            service.type
          )}`
        )
        if (!result.success)
          throw new Error('Could not verify the current table rows.')
        counts[table] = Number(result.rows[0]?.count)
        if (!Number.isSafeInteger(counts[table]))
          throw new Error('The affected row count could not be verified.')
      }
      for (const statement of statements.filter(
        (item) =>
          item.type === 'create_index' &&
          item.unique &&
          schema[item.table]?.columns.some(
            (column) => column.name === item.column
          )
      )) {
        const column = quoteIdentifier(statement.column, service.type)
        const result = await sails.helpers.dock.executeSql(
          service,
          `SELECT COUNT(*) AS count FROM (SELECT ${column} FROM ${quoteIdentifier(
            statement.table,
            service.type
          )} WHERE ${column} IS NOT NULL GROUP BY ${column} HAVING COUNT(*) > 1) AS duplicate_keys`
        )
        if (!result.success || Number(result.rows[0]?.count) !== 0)
          throw new Error(
            `Resolve duplicate values in ${statement.table}.${statement.column} before adding uniqueness.`
          )
      }
      const dumpArgs = pg
        ? [
            'exec',
            service.containerName,
            'pg_dump',
            '-U',
            service.username,
            '-d',
            service.database,
            '--schema-only',
            '--no-owner',
            '--no-privileges',
            '--no-tablespaces'
          ]
        : [
            'exec',
            service.containerName,
            'mysqldump',
            '-u',
            service.username,
            `-p${service.password}`,
            '--no-data',
            '--skip-lock-tables',
            '--routines',
            '--triggers',
            '--no-tablespaces',
            service.database
          ]
      const dump = (
        await exec(docker, dumpArgs, {
          timeout: 30000,
          maxBuffer: 20 * 1024 * 1024
        })
      ).stdout
      await exec(
        docker,
        [
          'run',
          '-d',
          '--rm',
          '--name',
          name,
          '--network',
          'none',
          '--memory',
          '512m',
          '--pids-limit',
          '256',
          '--cap-drop',
          'ALL',
          '--cap-add',
          'CHOWN',
          '--cap-add',
          'FOWNER',
          '--cap-add',
          'SETUID',
          '--cap-add',
          'SETGID',
          '--security-opt',
          'no-new-privileges',
          '--tmpfs',
          `${pg ? '/var/lib/postgresql/data' : '/var/lib/mysql'}:rw,size=512m`,
          ...(pg
            ? [
                '-e',
                'POSTGRES_HOST_AUTH_METHOD=trust',
                '-e',
                'PGDATA=/var/lib/postgresql/data'
              ]
            : [
                '-e',
                `MYSQL_ROOT_PASSWORD=${password}`,
                '-e',
                'MYSQL_DATABASE=fixture'
              ]),
          '--entrypoint',
          'timeout',
          inspection.Image,
          '-s',
          'KILL',
          '120',
          ...(inspection.Config.Entrypoint || ['docker-entrypoint.sh']),
          ...(inspection.Config.Cmd || [pg ? 'postgres' : 'mysqld'])
        ],
        { timeout: 15000, maxBuffer: 1024 * 1024 }
      )
      let ready = false
      while (Date.now() - started < 75000) {
        try {
          await exec(
            docker,
            pg
              ? ['exec', name, 'pg_isready', '-U', 'postgres']
              : [
                  'exec',
                  name,
                  'mysqladmin',
                  '-u',
                  'root',
                  `-p${password}`,
                  'ping'
                ],
            { timeout: 3000, maxBuffer: 1024 * 1024 }
          )
          ready = true
          break
        } catch (_) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
      if (!ready)
        throw new Error('The isolated database engine did not become ready.')
      await input(
        docker,
        pg
          ? [
              'exec',
              '-i',
              name,
              'psql',
              '-U',
              'postgres',
              '-d',
              'postgres',
              '-v',
              'ON_ERROR_STOP=1'
            ]
          : [
              'exec',
              '-i',
              name,
              'mysql',
              '-u',
              'root',
              `-p${password}`,
              'fixture'
            ],
        dump
      )
      for (const statement of statements) {
        const result = await sails.helpers.dock.executeSql(
          fixture,
          statement.sql
        )
        if (!result.success)
          throw new Error(
            `The ${statement.type} operation on ${statement.table} failed the isolated engine check. Review its native dependencies, cast, and defaults.`
          )
      }
      return {
        verified: true,
        engineImage: inspection.Image,
        schemaFingerprint: createHash('sha256')
          .update(JSON.stringify(schema))
          .digest('hex'),
        affectedRows: counts,
        statements: statements.map((statement) => ({
          ...statement,
          preflightVerified: true,
          affectedRows: counts[statement.table] || 0
        }))
      }
    } catch (error) {
      // Do not return database dumps, process arguments, credentials, or stderr.
      const message =
        error.code || error.cmd
          ? 'The isolated database preflight could not complete. Check database tools and available Docker resources, then retry.'
          : error.message
      return blocked(message)
    } finally {
      try {
        await exec(docker, ['rm', '-f', '-v', name], {
          timeout: 10000,
          maxBuffer: 1024 * 1024
        })
      } catch (_) {}
      active = false
    }
  }
}

function blocked(reason) {
  return {
    verified: false,
    reason,
    statements: [
      {
        type: 'blocked_preflight',
        blocked: true,
        reason,
        sql: '-- Automatic migration blocked: ' + reason
      }
    ]
  }
}

function input(binary, args, content) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    const timer = setTimeout(() => child.kill('SIGKILL'), 30000)
    child.stdin.on('error', () => {})
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      code === 0
        ? resolve()
        : reject(
            new Error(
              'The native schema could not be restored in the isolated engine.'
            )
          )
    })
    child.stdin.end(content)
  })
}
