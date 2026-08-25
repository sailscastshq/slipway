const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')
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

test('Lookout delegates chart rendering to copied Klean source', ({
  expect
}) => {
  const source = readFileSync(
    resolve('assets/js/pages/projects/lookout.vue'),
    'utf8'
  )

  expect(source).toContain(
    "import LineChart from '@/components/ui/line-chart/LineChart.vue'"
  )
  expect(source).toContain(
    "import Sparkline from '@/components/ui/sparkline/Sparkline.vue'"
  )
  expect(source).toContain("'cpuPercent',")
  expect(source).toContain("'memoryPercent',")
  expect(source).toContain(':format-value="formatPercent"')
  expect(source.includes('function sparklinePoints')).toBe(false)
  expect(source.includes('function detailChartPoints')).toBe(false)
  expect(source.includes('function onChartHover')).toBe(false)

  const lineChart = readFileSync(
    resolve('assets/js/components/ui/line-chart/LineChart.vue'),
    'utf8'
  )
  expect(lineChart).toContain('data-slot="line-chart-hit"')
  expect(lineChart).toContain('group-focus:opacity-100')
  expect(lineChart).toContain('role="list"')

  const sparkline = readFileSync(
    resolve('assets/js/components/ui/sparkline/Sparkline.vue'),
    'utf8'
  )
  expect(sparkline).toContain('data-slot="sparkline"')
  expect(sparkline).toContain(':aria-hidden="label ? undefined : \'true\'"')
})
