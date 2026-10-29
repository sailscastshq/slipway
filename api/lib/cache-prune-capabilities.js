// Docker builder can delegate to Buildx. Buildx renamed keep-storage to
// reserved-space; both bind to the same reservedSpace option. Do not replace
// it with max-used-space or min-free-space, which have different semantics.
function parse(help) {
  const flags = new Set(
    [
      ...String(help).matchAll(
        /^\s*(?:-[a-zA-Z],\s*)?(--[a-z][a-z0-9-]*)(?=\s|=|$)/gm
      )
    ].map((match) => match[1])
  )
  const storageFlag = flags.has('--reserved-space')
    ? '--reserved-space'
    : flags.has('--keep-storage')
    ? '--keep-storage'
    : null
  return {
    supported:
      storageFlag !== null &&
      ['--all', '--filter', '--force'].every((flag) => flags.has(flag)),
    storageFlag
  }
}

module.exports = { parse }
