const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { parse } = require('../../../api/lib/cache-prune-capabilities')
const modern = fs.readFileSync(
  path.resolve(
    __dirname,
    '../../fixtures/docker-build-cache-help/buildx-0.38.1.txt'
  ),
  'utf8'
)
const legacy =
  'Options:\n  -a, --all\n      --filter filter\n      --keep-storage bytes\n  -f, --force\n'

test('installed Buildx help supports the same retention policy through reserved-space despite hidden deprecated keep-storage', () => {
  assert.equal(modern.includes('--keep-storage'), false)
  assert.deepEqual(parse(modern), {
    supported: true,
    storageFlag: '--reserved-space'
  })
  assert.deepEqual(parse(legacy), {
    supported: true,
    storageFlag: '--keep-storage'
  })
  assert.deepEqual(parse(legacy + '      --reserved-space bytes\n'), {
    supported: true,
    storageFlag: '--reserved-space'
  })
})

test('missing age/confirmation/all or retention options remain unsupported; other storage semantics are never substituted', () => {
  for (const flag of ['--all', '--filter', '--force', '--reserved-space']) {
    const missing = modern
      .split('\n')
      .filter((line) => !line.includes(flag))
      .join('\n')
    assert.equal(parse(missing).supported, false)
  }
  assert.equal(parse('').supported, false)
  assert.equal(
    parse(legacy.replace('--filter', '--filter-label')).supported,
    false
  )
  assert.equal(
    parse(legacy.replace('--keep-storage', '--keep-storage-other')).supported,
    false
  )
  assert.equal(
    parse('Description: --all --filter --force --reserved-space').supported,
    false
  )
})
