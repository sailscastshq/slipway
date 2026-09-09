const { test } = require('sounding')
const { randomUUID } = require('node:crypto')
const plans = require('../../../../api/lib/migration-plans')

test(
  'migration plans bind actor, target, expiry, complete selections, and one-time use',
  { world: { name: 'configured-slipway' } },
  async ({ world, expect }) => {
    const actor = {
      id: world.current.users.genesisUser.id,
      team: world.current.teams.genesisTeam.id
    }
    const target = {
      key: randomUUID(),
      physicalKey: randomUUID(),
      dialect: 'sqlite'
    }
    const statements = [
      {
        type: 'create_table',
        table: 'notes',
        sql: 'CREATE TABLE notes (name TEXT);'
      },
      {
        type: 'create_index',
        table: 'notes',
        sql: 'CREATE INDEX notes_name ON notes(name);'
      }
    ]
    const input = {
      actor,
      target,
      models: {},
      source: { revision: 'one' },
      schema: {},
      statements
    }
    const preview = await plans.create(input)
    const args = {
      id: preview.id,
      hash: preview.hash,
      actor,
      target,
      operationIds: preview.statements.map((item) => item.operationId)
    }
    const code = (operation) => {
      try {
        operation()
        return null
      } catch (error) {
        return error.code
      }
    }
    expect(
      code(() =>
        plans.claim({ ...args, actor: { ...actor, id: actor.id + 1 } })
      )
    ).toBe('invalidMigrationPlan')
    expect(code(() => plans.claim({ ...args, hash: 'modified' }))).toBe(
      'invalidMigrationPlan'
    )
    expect(
      code(() => plans.claim({ ...args, target: { ...target, key: 'other' } }))
    ).toBe('invalidMigrationPlan')
    expect(
      code(() => plans.claim({ ...args, operationIds: [args.operationIds[0]] }))
    ).toBe('invalidMigrationPlan')
    expect(
      code(() => plans.claim({ ...args, operationIds: ['unreviewed'] }))
    ).toBe('invalidMigrationPlan')
    const concurrent = await plans.create(input)
    preview.statements[0].sql = 'DROP TABLE users;'
    const entry = plans.claim(args)
    expect(entry.selected[0].sql).toBe('CREATE TABLE notes (name TEXT);')
    expect(
      code(() =>
        plans.validate(entry, { ...input, source: { revision: 'two' } })
      )
    ).toBe('staleMigrationPlan')
    expect(
      code(() =>
        plans.claim({
          ...args,
          id: concurrent.id,
          hash: concurrent.hash,
          operationIds: concurrent.statements.map((item) => item.operationId)
        })
      )
    ).toBe('migrationBusy')
    entry.release()
    expect(code(() => plans.claim(args))).toBe('usedMigrationPlan')
    const now = Date.now
    try {
      Date.now = () => concurrent.expiresAt + 1
      expect(
        code(() =>
          plans.claim({ ...args, id: concurrent.id, hash: concurrent.hash })
        )
      ).toBe('expiredMigrationPlan')
    } finally {
      Date.now = now
    }
  }
)
