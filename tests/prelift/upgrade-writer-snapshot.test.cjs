const test = require('node:test')
const assert = require('node:assert/strict')
const {
  containerSnapshotHash
} = require('../../api/lib/upgrade-writer-observer')
test('Docker inventory accepts arbitrary mount order but rejects changed identity or writer policy', () => {
  const original = {
    id: 'fixture-container',
    pid: 123,
    running: false,
    paused: false,
    restarting: false,
    restart: 'no',
    mounts: [
      {
        Destination: '/app',
        Source: '/fixture/source',
        RW: false,
        Type: 'bind',
        Propagation: 'rprivate'
      },
      {
        Destination: '/app/db',
        Source: '/fixture/data',
        RW: true,
        Type: 'bind',
        Propagation: 'rprivate'
      }
    ]
  }
  const baseline = containerSnapshotHash(original)
  assert.equal(
    containerSnapshotHash({
      ...original,
      mounts: [...original.mounts].reverse()
    }),
    baseline
  )
  for (const changed of [
    { id: 'replacement' },
    { pid: 124 },
    { running: true },
    { paused: true },
    { restarting: true },
    { restart: 'always' },
    { mounts: original.mounts.slice(1) },
    { mounts: [...original.mounts, original.mounts[0]] },
    ...['Source', 'RW', 'Destination', 'Propagation'].map((field) => ({
      mounts: [
        original.mounts[0],
        { ...original.mounts[1], [field]: field === 'RW' ? false : 'changed' }
      ]
    }))
  ])
    assert.notEqual(
      containerSnapshotHash({ ...original, ...changed }),
      baseline
    )
})
