const DEFAULT_SECONDS = 120
const MIN_SECONDS = 5
const MAX_SECONDS = 600
function seconds(value) {
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new Error(
      'Startup window must be a whole number of seconds between 5 and 600.'
    )
  const number = Number(value)
  if (
    !Number.isSafeInteger(number) ||
    number < MIN_SECONDS ||
    number > MAX_SECONDS
  )
    throw new Error(
      'Startup window must be a whole number of seconds between 5 and 600.'
    )
  return number
}
module.exports = {
  friendlyName: 'Resolve startup readiness window',
  sync: true,
  inputs: { resourceLimits: { type: 'ref', defaultsTo: {} } },
  exits: { success: { outputType: 'number' } },
  fn: function ({ resourceLimits }) {
    return (
      seconds(
        resourceLimits?.startupTimeoutSeconds ??
          sails.config.custom.deploymentStartupTimeoutSeconds ??
          DEFAULT_SECONDS
      ) * 1000
    )
  }
}
module.exports._private = { seconds, DEFAULT_SECONDS, MIN_SECONDS, MAX_SECONDS }
