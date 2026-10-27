const reasons = {
  'image-cleanup-guard-present': 'Another cleanup owns the disk guard.',
  'image-use-guard-present': 'A deployment or update owns the disk guard.',
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
    'A deployment or maintenance operation owns the disk guard.',
  'image-operation-guard-busy':
    'A deployment or maintenance operation owns the disk guard.'
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
