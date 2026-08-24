const { test } = require('sounding')

test('DataTable URLs keep app query state and remove conventional defaults', async ({
  expect
}) => {
  const { dataTableUrl } = await import(
    '../../../assets/js/composables/useDataTableQuery.js'
  )

  expect(
    dataTableUrl(
      '/bridge/course?dashboard=ops#records',
      {
        page: 1,
        sort: 'title DESC',
        search: '',
        filters: {},
        lens: 'recent'
      },
      { sort: 'createdAt DESC', lens: '' }
    )
  ).toBe('/bridge/course?dashboard=ops&sort=title+DESC&lens=recent#records')

  expect(
    dataTableUrl('/bridge/course', {
      page: 3,
      filters: { published: { operator: 'equals', value: true } }
    })
  ).toBe(
    '/bridge/course?page=3&filters=%7B%22published%22%3A%7B%22operator%22%3A%22equals%22%2C%22value%22%3Atrue%7D%7D'
  )
})
