const reasons = {
  'image-cleanup-guard-present':
    'A cleanup guard is retained; inspect its outcome.',
  'image-use-guard-present':
    'A disk-use guard is retained; review current ownership.',
  'image-guard-inventory-unverified':
    'Disk guard ownership could not be verified.',
  'image-admission-guard-busy': 'Another operation is checking disk ownership.',
  'image-guard-recovery-incomplete':
    'Disk guard recovery needs operator inspection.',
  'instance-update-active': 'A Slipway update is still active.',
  'disk-inventory-unavailable': 'Host disk measurements are unavailable.',
  'active-build-or-deployment': 'A build or deployment is still active.',
  'bounded-cache-prune-unsupported':
    'Docker does not support the bounded cleanup policy.',
  'policy-changed': 'The cache cleanup policy changed during admission.',
  'run-time-limit': 'The cleanup admission time limit was reached.',
  'image-operation-guard-present':
    'A disk guard is retained; review current ownership.',
  'image-operation-guard-busy':
    'Disk guard admission is held; review current ownership.'
}
function holdDescription(holds) {
  const values = Array.isArray(holds)
    ? holds.filter((value) => typeof value === 'string').slice(0, 10)
    : []
  return values.length
    ? values.map((value) => reasons[value] || value.slice(0, 150)).join(' ')
    : 'A safety check prevented cleanup. Open the review for current details.'
}
module.exports = { holdDescription }
