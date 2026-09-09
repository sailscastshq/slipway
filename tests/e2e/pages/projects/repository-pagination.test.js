const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

for (const flow of ['create', 'connect']) {
  test(
    `repository picker ${flow} searches beyond 100, retries a failed page, and connects by ID`,
    {
      browser: true,
      world: {
        name: 'configured-slipway',
        context: {
          deploymentTarget: {
            slug: `repo-pagination-${flow}`,
            name: 'Repository pagination'
          }
        }
      }
    },
    async ({ sails, world, login, page, expect }) => {
      const current = world.current
      const provider = await world.create('gitprovider').with({
        team: current.teams.genesisTeam.id,
        clientSecret: `pagination-${flow}`
      })
      const originalFetch = global.fetch
      const pages = []
      const selected = []
      let failPage = true
      const repo = (id) => ({
        id,
        name: id === 201 ? 'sailsconf.com' : `project-${id}`,
        full_name: `sailscastshq/${
          id === 201 ? 'sailsconf.com' : `project-${id}`
        }`,
        owner: { login: 'sailscastshq' },
        default_branch: 'main',
        ssh_url: `git@github.com:sailscastshq/project-${id}.git`,
        html_url: `https://github.com/sailscastshq/project-${id}`,
        private: true
      })
      global.fetch = async (url, options) => {
        if (!String(url).startsWith('https://api.github.com/'))
          return originalFetch(url, options)
        assert.equal(options.headers.Authorization, `Bearer pagination-${flow}`)
        const parsed = new URL(url)
        if (parsed.pathname === '/user/repos') {
          const number = Number(parsed.searchParams.get('page'))
          pages.push(number)
          assert.equal(parsed.searchParams.get('per_page'), '100')
          if (number === 2 && failPage) {
            failPage = false
            return new Response('', { status: 503 })
          }
          const repos =
            number === 3
              ? [repo(201)]
              : Array.from({ length: 100 }, (_, i) =>
                  repo((number - 1) * 100 + i + 1)
                )
          return Response.json(repos, {
            headers:
              number < 3
                ? {
                    link: `<https://api.github.com/user/repos?page=${
                      number + 1
                    }>; rel="next"`
                  }
                : {}
          })
        }
        if (parsed.pathname === '/repositories/201') {
          selected.push(parsed.pathname)
          return Response.json(repo(201))
        }
        if (parsed.pathname.endsWith('/branches'))
          return Response.json([{ name: 'main', protected: false }])
        if (parsed.pathname.endsWith('/keys') && options.method === 'POST')
          return Response.json({ id: 301 })
        if (parsed.pathname.endsWith('/hooks') && options.method === 'POST')
          return Response.json({
            id: 401,
            config: { url: JSON.parse(options.body).config.url },
            events: ['push'],
            active: true
          })
        throw new Error(`Unexpected GitHub request: ${parsed.pathname}`)
      }
      try {
        await login.withPassword('genesisUser', page, {
          password: current.auth.genesisUserPassword
        })
        const base = `/projects/${current.projects.deploymentTarget.slug}/environments/production`
        await page.goto(
          flow === 'create'
            ? `${base}?apps=1`
            : `${base}/apps/${current.apps.web.slug}/settings`
        )
        if (flow === 'create') {
          await page.raw
            .getByRole('button', { name: '+ Add app', exact: true })
            .click()
          await page.raw
            .getByPlaceholder('app name', { exact: true })
            .fill('conference')
        }
        const input = page.raw.getByPlaceholder(
          flow === 'create'
            ? 'Link a GitHub repository (optional)'
            : 'Search repositories...'
        )
        await input.fill('sailsconf')
        await expect(
          page.raw
            .getByRole('alert')
            .filter({ hasText: 'Could not load all repositories' })
        ).toBeVisible()
        await expect(
          page.raw.getByText('No repositories found', { exact: true })
        ).toHaveCount(0)
        const screenshots = path.resolve('output/issue-534')
        fs.mkdirSync(screenshots, { recursive: true })
        await input.scrollIntoViewIfNeeded()
        await page.raw.screenshot({
          path: path.join(screenshots, `${flow}-retry.png`),
          animations: 'disabled'
        })
        await page.raw
          .getByRole('button', { name: 'Retry', exact: true })
          .click()
        const result = page.raw.getByRole('button', {
          name: 'sailscastshq/ sailsconf.com'
        })
        await expect(result).toBeVisible()
        assert.deepEqual(pages, [1, 2, 2, 3])
        await page.raw.setViewportSize({
          width: flow === 'create' ? 1440 : 390,
          height: 1000
        })
        await page.raw.emulateMedia({
          colorScheme: flow === 'create' ? 'light' : 'dark'
        })
        await input.scrollIntoViewIfNeeded()
        await page.raw.screenshot({
          path: path.join(screenshots, `${flow}-results.png`),
          animations: 'disabled'
        })
        const style = await input.evaluate((el) => {
          const box = el.getBoundingClientRect()
          return {
            border: getComputedStyle(el).borderBottomStyle,
            fits: box.left >= 0 && box.right <= innerWidth
          }
        })
        assert.equal(style.border, 'dashed')
        assert.equal(style.fits, true)
        await result.click()
        const saved = page.raw.waitForResponse(
          (response) =>
            response.request().method() === 'POST' &&
            response
              .url()
              .endsWith(flow === 'create' ? '/apps' : '/connect-repo')
        )
        await page.raw
          .getByRole('button', {
            name: flow === 'create' ? 'Create' : 'Connect repository',
            exact: true
          })
          .click()
        const response = await saved
        assert.ok(
          response.status() < 400 ||
            (response.status() === 409 &&
              response.headers()['x-inertia-location'])
        )
        const record = await sails.models.gitrepository.findOne({
          externalId: '201',
          provider: provider.id
        })
        const app = await sails.models.app.findOne({ id: record.app })
        assert.equal(
          app.slug,
          flow === 'create' ? 'conference' : current.apps.web.slug
        )
        assert.deepEqual(selected, ['/repositories/201'])
        assert.deepEqual(pages, [1, 2, 2, 3])
      } finally {
        global.fetch = originalFetch
      }
    }
  )
}
