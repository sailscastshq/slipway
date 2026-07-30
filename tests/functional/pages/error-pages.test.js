const { test } = require('sounding')

const browserHeaders = {
  accept: 'text/html, application/xhtml+xml'
}

test(
  'unknown browser routes render the Slipway 404 page',
  { transport: 'http' },
  async ({ request, expect }) => {
    const browser = request.withHeaders(browserHeaders)
    const response = await browser.get('/this-slipway-page-does-not-exist')

    expect(response).toHaveStatus(404)
    expect(response.body).toContain('<title>Page not found | Slipway</title>')
    expect(response.body).toContain('data-error-page="404"')
    expect(response.body).toContain('Page not found')
    expect(response.body.includes('sailsjs.com')).toBe(false)
    expect(response.body.includes('data:image')).toBe(false)
  }
)

test(
  'production browser errors render a safe Slipway 500 page',
  { world: 'configured-slipway', transport: 'http' },
  async ({ sails, request, world, expect }) => {
    const token = 'production-error-page-probe'
    const previousNodeEnvironment = process.env.NODE_ENV
    const browser = request.withHeaders(browserHeaders)

    await sails.models.user
      .updateOne({ id: world.current.users.genesisUser.id })
      .set({
        emailStatus: 'change-requested',
        emailProofToken: token,
        emailProofTokenExpiresAt: Date.now() + 60 * 1000
      })

    process.env.NODE_ENV = 'production'

    try {
      const response = await browser.get(`/verify-email?token=${token}`)

      expect(response).toHaveStatus(500)
      expect(response.body).toContain(
        '<title>Something went wrong | Slipway</title>'
      )
      expect(response.body).toContain('data-error-page="500"')
      expect(response.body).toContain('Something went wrong')
      expect(response.body.includes('Consistency violation')).toBe(false)
      expect(response.body.includes('emailChangeCandidate')).toBe(false)
      expect(response.body.includes('sailsjs.com')).toBe(false)
      expect(response.body.includes('data:image')).toBe(false)
    } finally {
      process.env.NODE_ENV = previousNodeEnvironment
    }
  }
)
