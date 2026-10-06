const createMigrationExecutor = require('../../lib/migration-executor')
const context = require('../../lib/migration-context')
const plans = require('../../lib/migration-plans')
const openPostgresSession = require('../../lib/postgres-migration-session')

module.exports = {
  friendlyName: 'Apply server migration plan',
  description:
    'Revalidate, lock, execute, and verify a reviewed plan before committing.',
  inputs: {
    entry: { type: 'ref', required: true },
    actor: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function (inputs) {
    return createMigrationExecutor({
      context,
      openPostgresSession,
      audit: plans.audit,
      getSchema: (service) => sails.helpers.dock.getSchema(service),
      generateDiff: (...args) => sails.helpers.dock.generateDiff(...args),
      generateMigrationSql: (...args) =>
        sails.helpers.dock.generateMigrationSql(...args),
      applySqliteMigration: (args) =>
        sails.helpers.dock.applySqliteMigration.with(args),
      executeSql: (...args) => sails.helpers.dock.executeSql(...args)
    })(inputs)
  }
}
