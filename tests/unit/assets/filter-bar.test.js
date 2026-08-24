const { test } = require('sounding')

test('Filter Bar URLs preserve app state and deterministic typed filters', async ({
  expect
}) => {
  const { filterUrl, filtersFromUrl, stableFilters } = await import(
    '../../../assets/js/components/ui/filter-bar/filterState.js'
  )
  const filters = {
    published: { value: 'true', operator: 'equals' },
    createdAt: {
      to: '2026-08-24',
      operator: 'between',
      from: '2026-08-01'
    }
  }

  expect(stableFilters(filters)).toBe(
    '{"createdAt":{"from":"2026-08-01","operator":"between","to":"2026-08-24"},"published":{"operator":"equals","value":"true"}}'
  )

  const url = filterUrl('/bridge/course?lens=recent#records', filters)
  expect(url).toContain('/bridge/course?lens=recent&filters=')
  expect(url.endsWith('#records')).toBe(true)
  expect(filtersFromUrl(url)).toEqual(filters)
  expect(filterUrl(url, {})).toBe('/bridge/course?lens=recent#records')
  expect(
    filtersFromUrl('/bridge/course?filters=not-json', { safe: true })
  ).toEqual({ safe: true })
})
