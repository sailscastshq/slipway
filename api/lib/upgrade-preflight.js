const fs = require('node:fs')
const path = require('node:path')
const createExecutor = require('./migration-executor')
const plans = require('./migration-plans')
const ledger = require('./upgrade-ledger')
const { verifyBackupSet } = require('./upgrade-backups')
const readSchema = require('./sqlite-schema')
const generateDiff = require('../helpers/dock/generate-diff').fn
const generateSql = require('../helpers/dock/generate-migration-sql').fn
const applySqliteMigration =
  require('../helpers/dock/apply-sqlite-migration').fn

// All SQL runs on private verified clones through the existing transaction
// engine. The trusted release registry supplies models and reviewed entries;
// no caller-selected SQL, Sails lift, ORM or application jobs run here.
module.exports = async function runUpgradePreflight({
  backupSet,
  identity,
  preparePlan,
  timeoutMs
}) {
  const verified = ledger.createManifest(identity.manifest)
  if (verified.hash !== identity.hash || typeof preparePlan !== 'function')
    throw new Error(
      'Upgrade preflight requires an immutable manifest and plan registry.'
    )
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new Error('Upgrade preflight requires an explicit deadline.')
  const deadline = Date.now() + timeoutMs
  function remaining() {
    const duration = deadline - Date.now()
    if (duration <= 0)
      throw new Error('Upgrade preflight exceeded its deadline.')
    return duration
  }
  const receipt = await verifyBackupSet(backupSet, remaining())
  const directory = fs.mkdtempSync(path.join(backupSet.directory, 'preflight-'))
  fs.chmodSync(directory, 0o700)
  const steps = []
  const source = {
    version: identity.manifest.version,
    image: identity.manifest.image
  }
  try {
    for (const snapshot of receipt.snapshots) {
      const filename = path.join(directory, snapshot.file)
      fs.copyFileSync(
        path.join(backupSet.directory, snapshot.file),
        filename,
        fs.constants.COPYFILE_EXCL
      )
      fs.chmodSync(filename, 0o600)
    }
    fs.copyFileSync(
      path.join(backupSet.directory, 'receipt.json'),
      path.join(directory, 'receipt.json'),
      fs.constants.COPYFILE_EXCL
    )
    fs.chmodSync(path.join(directory, 'receipt.json'), 0o600)
    await verifyBackupSet({ ...backupSet, directory }, remaining())
    const services = new Map()
    for (const step of identity.manifest.steps) {
      remaining()
      const snapshot = receipt.snapshots.find(
        (item) => item.datastore === step.datastore
      )
      if (!snapshot)
        throw new Error('Preflight is missing an affected database backup.')
      services.set(step.datastore, {
        service: {
          type: 'sqlite',
          datastore: step.datastore,
          path: path.join(directory, snapshot.file)
        },
        snapshot
      })
    }
    for (const { service, snapshot } of services.values())
      ledger.inspectState(service, identity, snapshot.databaseKey)
    for (const step of identity.manifest.steps) {
      const { service, snapshot } = services.get(step.datastore)
      const state = ledger.inspectState(service, identity, snapshot.databaseKey)
      if (!state.pending.includes(step.id)) {
        steps.push({ stepId: step.id, outcome: 'alreadyApplied' })
        continue
      }
      let timer
      let prepared
      try {
        prepared = await Promise.race([
          preparePlan({ step, service, source }),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error('Upgrade preflight exceeded its deadline.')),
              remaining()
            )
          })
        ])
      } finally {
        clearTimeout(timer)
      }
      const { entry, models } = prepared
      if (
        typeof entry?.release !== 'function' ||
        entry.payload?.target?.physicalKey !== snapshot.databaseKey ||
        entry.payload?.sourceHash !== plans.digest(source)
      )
        throw new Error(
          'Preflight plan does not match the pinned source and target.'
        )
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
        audit: async () => {},
        getSchema: async (target) => readSchema(target),
        generateDiff: (models, schema, dbType) =>
          generateDiff({ models, schema, dbType }),
        generateMigrationSql: (diff, dbType, models, schema) =>
          generateSql({ diff, dbType, models, schema }),
        applySqliteMigration,
        executeSql: async () => {
          throw new Error('Preflight must use its locked SQLite clone.')
        },
        openPostgresSession: () => {
          throw new Error('Preflight only supports owned SQLite databases.')
        },
        beforeCommit: (input) => {
          remaining()
          return ledger.receiptWriter({
            identity,
            stepId: step.id,
            databaseKey: snapshot.databaseKey,
            fenceId: receipt.fenceId,
            backupId: backupSet.id
          })(input)
        }
      })
      const result = await execute({ entry, actor: { id: 0, team: 0 } })
      if (!result.success) {
        const error = new Error(
          `Upgrade clone preflight failed: ${result.error}`
        )
        error.code = result.code
        throw error
      }
      ledger.inspectState(service, identity, snapshot.databaseKey)
      steps.push({ stepId: step.id, outcome: 'verifiedOnClone' })
    }
    for (const { service, snapshot } of services.values())
      if (
        !ledger.inspectState(service, identity, snapshot.databaseKey).complete
      )
        throw new Error(
          'Upgrade preflight did not reach the complete release schema.'
        )
    remaining()
    return {
      dryRun: true,
      manifestHash: identity.hash,
      backupId: backupSet.id,
      steps
    }
  } finally {
    // Applied clone receipts never become live applied ledger entries.
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
