module.exports = {
  friendlyName: 'Format Docker error',
  description: 'Keep daemon diagnostics without logging command credentials.',
  sync: true,
  inputs: {
    error: { type: 'ref', required: true },
    args: { type: 'ref', defaultsTo: [] }
  },
  exits: { success: { outputType: 'string' } },
  fn: function ({ error, args }) {
    return formatDockerError(error, args)
  }
}

// Also serialized into the isolated Bosun process, which has no Sails instance.
function formatDockerError(error, args = []) {
  const stderr = String(error?.stderr || '').trim()
  if (!stderr) return 'Docker command failed; command arguments withheld.'
  if (Buffer.byteLength(stderr) > 64 * 1024)
    return 'Docker command failed; oversized diagnostic withheld.'
  let message = stderr
  const assignments = []
  for (let index = 0; index < args.length; index++) {
    if (!['-e', '--env'].includes(args[index])) continue
    const assignment = String(args[++index] || '')
    const separator = assignment.indexOf('=')
    if (separator < 0) continue
    const key = assignment.slice(0, separator)
    const value = assignment.slice(separator + 1)
    assignments.push({ key, value })
    message = message.split(assignment).join(`${key}=<redacted>`)
  }
  for (const { key, value } of assignments.sort(
    (a, b) => b.value.length - a.value.length
  )) {
    // Numeric values must not erase unrelated ports, addresses or identifiers.
    // The owned host address is public routing configuration, not a credential.
    if (
      value.length < 8 ||
      (key === 'SLIPWAY_APP_PORT_HOST' && require('node:net').isIP(value))
    )
      continue
    message = message.split(value).join('<redacted>')
  }
  return message
}

module.exports._private = { formatDockerError }
