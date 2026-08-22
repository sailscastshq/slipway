const { test } = require('sounding')

const STATUSES = [403, 404, 419, 429, 500, 503]

test(
  'global error responses preserve HTML, Inertia, and JSON contracts',
  {
    transport: 'http'
  },
  async ({ request, expect }) => {
    for (const status of STATUSES) {
      const path = `/__sounding/errors/${status}`
      const html = await request.withHeaders({ accept: 'text/html' }).get(path)

      expect(html).toHaveStatus(status)
      expect(html.header('content-type')).toContain('text/html')
      expect(html.body).toContain(`data-error-page="${status}"`)
      expect(html.body).toContain('Slipway')
      expect(html.body.includes('Private test failure')).toBe(false)

      const inertia = await request
        .withHeaders({
          'x-inertia': 'true',
          accept: 'text/html, application/xhtml+xml'
        })
        .get(path)

      expect(inertia).toHaveStatus(status)
      expect(inertia).toBeInertiaPage('errors/status')
      expect(inertia).toHaveInertiaProps({ status })
      expect(inertia.data.props.headline).toBeTruthy()
      expect(inertia.data.props.message).toBeTruthy()
      expect(inertia.data.props.actions.length <= 2).toBe(true)
      expect(
        JSON.stringify(inertia.data.props).includes('Private test failure')
      ).toBe(false)

      const json = await request
        .withHeaders({ accept: 'application/json' })
        .get(path)

      expect(json).toHaveStatus(status)
      expect(json).toHaveJsonPath('error.status', status)
      expect(json.data.error.title).toBeTruthy()
      expect(json.data.error.message).toBeTruthy()
      expect(JSON.stringify(json.data).includes('Private test failure')).toBe(
        false
      )

      if (status === 429) {
        expect(html).toHaveHeader('retry-after', '60')
        expect(inertia).toHaveHeader('retry-after', '60')
        expect(json).toHaveHeader('retry-after', '60')
      }
    }
  }
)

test(
  'unmatched routes use the shared 404 recovery page',
  {
    transport: 'http'
  },
  async ({ request, expect }) => {
    const response = await request
      .withHeaders({ accept: 'text/html' })
      .get('/this-slipway-page-does-not-exist')

    expect(response).toHaveStatus(404)
    expect(response.body).toContain('data-error-page="404"')
    expect(response.body).toContain('Nothing is here')
  }
)
