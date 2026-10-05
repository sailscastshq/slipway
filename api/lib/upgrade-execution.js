const createExecutor = require('./migration-executor')
const plans = require('./migration-plans')
const ledger = require('./upgrade-ledger')
const readSchema = require('./sqlite-schema')
const generateDiff = require('../helpers/dock/generate-diff').fn
const generateSql = require('../helpers/dock/generate-migration-sql').fn
const applySqliteMigration =
  require('../helpers/dock/apply-sqlite-migration').fn

// Both clone preflight and live coordination use this adapter for the one
// existing transaction engine. Native release plans validate the full catalog,
// including constraints and partial/expression indexes that models cannot own.
module.exports = async function executeUpgradeStep({
  prepared,
  identity,
  step,
  service,
  databaseKey,
  backupId,
  fenceId,
  beforeCommit = async () => {},
  audit = async () => {},
  remaining = () => {},
  actor = { id: 0, team: 0 }
}) {
  const verified = ledger.createManifest(identity.manifest)
  const registered = identity.manifest.steps.find((item) => item.id === step.id)
  if (
    verified.hash !== identity.hash ||
    !registered ||
    ledger.digest(registered) !== ledger.digest(step)
  )
    throw new Error(
      'Upgrade execution step differs from the immutable manifest.'
    )
  const source = {
    version: identity.manifest.version,
    image: identity.manifest.image
  }
  const { entry, models } = prepared
  if (
    typeof entry?.release !== 'function' ||
    entry.payload?.target?.physicalKey !== databaseKey ||
    entry.payload?.sourceHash !== plans.digest(source) ||
    ledger.digest(entry.selected.map(plans.contract)) !== step.operationsHash
  )
    throw new Error(
      'Upgrade plan does not match the pinned source and target or registered operations.'
    )
  const nativeDiff = (_, schema) => {
    const tables = { ...schema }
    delete tables[ledger.table]
    const hash = ledger.digest(tables)
    return {
      state:
        hash === step.toSchemaHash
          ? 'up_to_date'
          : hash === step.fromSchemaHash
          ? 'changes_pending'
          : 'unverified'
    }
  }
  const nativeSql = (diff) => ({
    statements:
      diff.state === 'unverified'
        ? [{ blocked: true, sql: '-- Unknown native upgrade schema.' }]
        : entry.payload.statements
  })
  if (
    prepared.native &&
    ledger.digest(entry.payload.statements.map(plans.contract)) !==
      step.operationsHash
  )
    throw new Error(
      'Native upgrade statements differ from the registered operations.'
    )
  remaining()
  const execute = createExecutor({
    context: {
      refresh: async () => ({
        service,
        target: entry.payload.target,
        source,
        models
      }),
      refreshVersion: async () => source
    },
    audit,
    getSchema: async (target) => readSchema(target),
    generateDiff: prepared.native
      ? nativeDiff
      : (models, schema, dbType) => generateDiff({ models, schema, dbType }),
    generateMigrationSql: prepared.native
      ? nativeSql
      : (diff, dbType, models, schema) =>
          generateSql({ diff, dbType, models, schema }),
    applySqliteMigration,
    executeSql: async () => {
      throw new Error('Owned upgrades must use the locked SQLite connection.')
    },
    openPostgresSession: () => {
      throw new Error('Owned upgrades only support SQLite databases.')
    },
    beforeCommit: async (input) => {
      remaining()
      await beforeCommit(input)
      remaining()
      ledger.receiptWriter({
        identity,
        stepId: step.id,
        databaseKey,
        fenceId,
        backupId
      })(input)
    }
  })
  return execute({ entry, actor })
}
