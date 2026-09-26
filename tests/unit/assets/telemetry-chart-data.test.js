const { test } = require('sounding')

test('normalizes Slipway telemetry into exact Klean chart points', async ({
  expect
}) => {
  const { toPercentChartData } = await import(
    '../../../assets/js/lib/telemetry-chart-data.mjs'
  )
  const points = toPercentChartData(
    [
      { cpu: 4, t: 100 },
      { cpu: '9.25', t: 200 },
      { cpu: null, t: 300 },
      { cpu: Number.NaN, t: 400 }
    ],
    'cpu',
    't',
    (timestamp) => `T${timestamp}`
  )

  expect(points).toEqual([
    { label: 'T100', value: 4, detail: 'T100, 4.0%' },
    { label: 'T200', value: 9.25, detail: 'T200, 9.3%' },
    {
      label: 'T300',
      value: undefined,
      detail: 'T300, sample unavailable'
    },
    {
      label: 'T400',
      value: undefined,
      detail: 'T400, sample unavailable'
    }
  ])
  expect(toPercentChartData(undefined, 'cpu', 't', String)).toEqual([])
})
