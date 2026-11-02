const path = require('node:path')

// Quest marks only the actual owned execution process before Sails is loaded.
// This is process-local state, not an environment value inherited by unrelated
// grandchildren, and it grants no administrative or application permissions.
function isQuestExecutionChild(runtime = process) {
  if (globalThis[Symbol.for('sails.quest.executionChild')] === true) return true
  return (
    /^sails(?:\.js)?$/.test(path.basename(runtime.argv?.[1] || '')) &&
    runtime.argv?.[2] === 'run'
  )
}
module.exports = { isQuestExecutionChild }
