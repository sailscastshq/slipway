const { execFile } = require('node:child_process')
const command = require('node:util').promisify(execFile)

module.exports = {
  friendlyName: 'Get build cache inventory',
  exits: { success: { outputType: 'ref' } },
  fn: async function () {
    const { stdout } = await command(
      sails.config.docker?.binaryPath || 'docker',
      ['system', 'df', '--format', '{{json .}}'],
      { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }
    )
    return parse(stdout)
  }
}

function parse(stdout) {
  const rows = String(stdout)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
  const caches = rows.filter((row) => /^build cache$/i.test(row.Type || ''))
  if (caches.length !== 1)
    throw new Error('Build cache inventory is incomplete.')
  const cache = caches[0]
  const integer = (value) =>
    /^(0|[1-9][0-9]*)$/.test(String(value)) &&
    Number.isSafeInteger(Number(value))
  if (
    !integer(cache.TotalCount) ||
    !integer(cache.Active) ||
    Number(cache.Active) > Number(cache.TotalCount) ||
    typeof cache.Size !== 'string' ||
    cache.Size.length > 100 ||
    typeof cache.Reclaimable !== 'string' ||
    cache.Reclaimable.length > 100
  )
    throw new Error('Build cache inventory is incomplete.')
  return {
    entries: Number(cache.TotalCount),
    active: Number(cache.Active),
    size: cache.Size,
    reclaimable: cache.Reclaimable
  }
}
module.exports._private = { parse }
