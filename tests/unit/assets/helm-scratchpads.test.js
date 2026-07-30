const { test } = require('sounding')

test('Helm scratchpads persist source, target, and view without result data', async ({
  expect
}) => {
  const {
    createHelmScratchpad,
    parseHelmScratchpadState,
    serializeHelmScratchpadState
  } = await import('../../../assets/js/lib/helmScratchpads.mjs')
  const target = targetFixture()
  const tab = {
    ...createHelmScratchpad({
      id: 'tab-1',
      name: 'Find creators',
      source: 'await Creator.find()',
      baselineSource: '',
      view: 'table',
      target,
      now: 100
    }),
    updatedAt: 200,
    result: { rows: [{ email: 'private@example.com' }] },
    logs: ['private log'],
    error: 'private error'
  }

  const serialized = serializeHelmScratchpadState({
    tabs: [tab],
    activeByTarget: { [tab.target.key]: tab.id }
  })
  const restored = parseHelmScratchpadState(serialized)

  expect(serialized.includes('private@example.com')).toBe(false)
  expect(serialized.includes('private log')).toBe(false)
  expect(serialized.includes('private error')).toBe(false)
  expect(restored.tabs[0]).toEqual({
    id: 'tab-1',
    name: 'Find creators',
    source: 'await Creator.find()',
    baselineSource: '',
    view: 'table',
    target: tab.target,
    createdAt: 100,
    updatedAt: 200
  })
  expect(restored.activeByTarget[tab.target.key]).toBe('tab-1')
})

test('Helm scratchpads accept numeric or UUID identities and reject unsafe stored state', async ({
  expect
}) => {
  const { createHelmScratchpad, parseHelmScratchpadState, snapshotHelmTarget } =
    await import('../../../assets/js/lib/helmScratchpads.mjs')
  const target = snapshotHelmTarget({
    project: {
      id: 'ca5b09ad-4778-4e07-a576-93d7c93defad',
      name: 'Hagfish',
      slug: 'hagfish'
    },
    environment: {
      id: 42,
      name: 'Production',
      slug: 'production',
      isProduction: true
    },
    app: {
      id: 'web-app',
      name: 'hagfish.app',
      slug: 'hagfish-app'
    }
  })

  expect(target.key).toBe('ca5b09ad-4778-4e07-a576-93d7c93defad:42:web-app')
  expect(target.href).toBe(
    '/projects/hagfish/environments/production/helm?appSlug=hagfish-app'
  )
  expect(target.environment.isProduction).toBe(true)
  expect(Boolean(createHelmScratchpad({ target }))).toBe(true)
  expect(parseHelmScratchpadState('{broken')).toEqual({
    tabs: [],
    activeByTarget: {}
  })
  expect(
    parseHelmScratchpadState({
      version: 1,
      tabs: [{ id: 'unsafe', source: '1 + 1', target: null }],
      activeByTarget: { unsafe: 'unsafe' }
    })
  ).toEqual({ tabs: [], activeByTarget: {} })
})

test('Helm scratchpad names remain distinct and modified state is derived', async ({
  expect
}) => {
  const {
    createHelmScratchpad,
    duplicateHelmScratchpadName,
    helmScratchpadIsModified,
    nextHelmScratchpadName
  } = await import('../../../assets/js/lib/helmScratchpads.mjs')
  const first = createHelmScratchpad({
    id: 'first',
    name: 'Scratchpad 1',
    source: '1 + 1',
    target: targetFixture()
  })
  const copy = createHelmScratchpad({
    id: 'copy',
    name: 'Copy of Scratchpad 1',
    source: '1 + 1',
    target: targetFixture()
  })

  expect(nextHelmScratchpadName([first, copy], first.target.key)).toBe(
    'Scratchpad 2'
  )
  expect(duplicateHelmScratchpadName([first, copy], first)).toBe(
    'Copy of Scratchpad 1 2'
  )
  expect(helmScratchpadIsModified(first)).toBe(false)
  expect(helmScratchpadIsModified({ ...first, source: '2 + 2' })).toBe(true)
})

function targetFixture() {
  return {
    project: { id: 1, name: 'Hagfish', slug: 'hagfish' },
    environment: {
      id: 2,
      name: 'Production',
      slug: 'production',
      isProduction: true
    },
    app: { id: 3, name: 'hagfish.app', slug: 'hagfish-app' }
  }
}
