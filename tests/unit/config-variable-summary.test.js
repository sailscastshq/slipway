const { test } = require('sounding')

test('configuration summaries keep the secure default quiet', async ({
  expect
}) => {
  const { configVariableSummary } = await import(
    '../../assets/js/lib/config-variables.mjs'
  )

  expect(configVariableSummary({ kind: 'secret' })).toBe('')
  expect(configVariableSummary({})).toBe('')
})

test('configuration summaries retain useful exceptional context', async ({
  expect
}) => {
  const { configVariableSummary } = await import(
    '../../assets/js/lib/config-variables.mjs'
  )

  expect(configVariableSummary({ kind: 'plain' })).toBe('Plain config')
  expect(
    configVariableSummary({ kind: 'secret' }, 'Kelvin · 2 minutes ago')
  ).toBe('Kelvin · 2 minutes ago')
  expect(
    configVariableSummary(
      { kind: 'secret', managed: true },
      'Slipway · just now'
    )
  ).toBe('Managed by Slipway · Slipway · just now')
})
