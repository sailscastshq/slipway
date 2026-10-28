const { test } = require('node:test')
const assert = require('node:assert/strict')
const { holdDescription } = require('../../../api/lib/cache-cleanup-feedback')
test('cleanup holds retain specific reasons without implying automatic retry', () => {
  assert.equal(
    holdDescription(['instance-update-active']),
    'A Slipway update is still active.'
  )
  assert.match(
    holdDescription(['image-use-guard-present']),
    /review current ownership/
  )
  assert.match(
    holdDescription(['active-build-or-deployment', 'policy-changed']),
    /active.*policy changed/
  )
  assert.match(holdDescription([]), /Open the review/)
  assert.equal(holdDescription(['new-reason']), 'new-reason')
  assert.equal(holdDescription(['a'.repeat(200)]).length, 150)
})
