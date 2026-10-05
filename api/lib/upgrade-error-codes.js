// Safe machine codes only. Raw native/SQL/Docker exception messages never cross
// the worker boundary; callers inspect durable recovery state for details.
module.exports = new Set([
  'upgradeLedgerMismatch',
  'upgradeStorageMismatch',
  'upgradeFenceLost',
  'upgradeFenceUnproved',
  'upgradeDockerFailed',
  'upgradeHostTarget',
  'upgradeHostTimeout',
  'upgradeHandoffRejected',
  'upgradeLaunchConfig',
  'upgradeRecoveryRequired',
  'upgradeBusy',
  'upgradeBackupFailed',
  'upgradeNotReady',
  'upgradeWorkerFailed'
])
