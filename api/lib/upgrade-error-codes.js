// Safe machine codes only. Raw native/SQL/Docker exception messages never cross
// the worker boundary; callers inspect durable recovery state for details.
module.exports = new Set([
  'upgradeLedgerMismatch',
  'upgradeStorageMismatch',
  'upgradeFenceLost',
  'upgradeRecoveryRequired',
  'upgradeBusy',
  'upgradeBackupFailed',
  'upgradeNotReady',
  'upgradeWorkerFailed'
])
