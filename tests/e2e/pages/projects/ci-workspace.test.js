const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const runs = require('../../../fixtures/ci/source-check-runs.json')
test(
  'CI uses the actual Slipway shell and dashed Klean select without approving source-only evidence',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: { slug: 'ci-native-review', name: 'sailsconf.com' }
      }
    }
  },
  async ({ world, page, login, expect }) => {
    const target = `/projects/${world.current.projects.deploymentTarget.slug}/ci`
    let showRuns = false
    await page.raw.route(`**${target}*`, async (route) => {
      const response = await route.fetch()
      const source = await response.text()
      const isJson = response
        .headers()
        ['content-type']?.includes('application/json')
      const match = isJson
        ? null
        : source.match(
            /(<script[^>]*type="application\/json"[^>]*data-page="app"[^>]*>)([\s\S]*?)(<\/script>)/
          )
      const payload = JSON.parse(isJson ? source : match[2])
      if (showRuns) payload.props.workspace.runs = runs
      const json = JSON.stringify(payload)
      await route.fulfill({
        response,
        body: isJson
          ? json
          : source.replace(
              match[0],
              `${match[1]}${json.replace(/</g, '\\u003c')}${match[3]}`
            )
      })
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'))
    await page.goto(target)
    await expect(
      page.raw.getByRole('heading', { name: 'No checks have run yet' })
    ).toBeVisible()
    showRuns = true
    await page.raw.getByRole('button', { name: 'Refresh CI runs' }).click()
    const selected = page.raw.getByRole('article', { name: 'Selected CI run' })
    await expect(selected).toContainText(
      'Required lint, tests and build · fixed'
    )
    await expect(selected).toContainText('Not approved')
    const filter = page.raw.getByRole('combobox', {
      name: 'Filter CI runs by state'
    })
    expect(
      await filter.evaluate((el) => getComputedStyle(el).borderBottomStyle)
    ).toBe('dashed')
    await filter.focus()
    await page.raw.keyboard.press('Enter')
    await expect(page.raw.getByRole('listbox')).toBeVisible()
    await page.raw.getByRole('option', { name: 'Passed', exact: true }).click()
    await page.raw
      .getByRole('button', { name: /^Original tests and build policy/ })
      .click()
    await expect(selected).toContainText('Original tests and build policy')
    await expect(selected).toContainText(
      'An application image has not been verified'
    )
    await expect(selected).toContainText('Not approved')
    await filter.click()
    await page.raw.getByRole('option', { name: 'Failed', exact: true }).click()
    await page.raw.getByRole('button', { name: 'Refresh CI runs' }).click()
    await expect(filter).toContainText('Failed')
    await filter.evaluate((element) => element.blur())
    const output = path.resolve('.tmp/screenshots/ci-native')
    fs.mkdirSync(output, { recursive: true })
    for (const width of [1440, 390]) {
      await page.resize(width, width === 390 ? 844 : 1000)
      for (const scheme of ['light', 'dark']) {
        await page.raw.emulateMedia({
          colorScheme: scheme,
          reducedMotion: 'reduce'
        })
        expect(
          await page.raw.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true)
        await page.screenshot(
          path.join(output, `failed-${width}-${scheme}.png`),
          { fullPage: true, animations: 'disabled' }
        )
      }
    }
    await page.raw.getByRole('button', { name: 'Review checks' }).click()
    await expect(
      page.raw.getByRole('tab', { name: 'Configuration', exact: true })
    ).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.raw.getByText(
        'Runner registration and saved policies are not available yet.',
        { exact: false }
      )
    ).toBeVisible()
    expect(page).toHaveNoJavascriptErrors()
  }
)
