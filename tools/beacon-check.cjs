#!/usr/bin/env node
const { probe } = require('../api/lib/beacon/probe')

async function main() {
  if (process.argv.length !== 3) throw new Error('usage')
  const result = await probe(process.argv[2])
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode =
    result.outcome === 'up' ? 0 : result.outcome === 'down' ? 1 : 2
}

main().catch(() => {
  // Never echo a rejected URL, query string, or user-supplied credentials.
  process.stderr.write(
    'Beacon requires one public HTTP(S) URL on its default port.\n'
  )
  process.exitCode = 2
})
