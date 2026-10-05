const { test } = require('sounding')
test(
  'coordinated upgrade reviews an exact plan before its keyboard-accessible Inertia mutation',
  { browser: true, world: 'configured-slipway' },
  async ({ login, world, page, expect }) => {
    const id = '11111111-1111-1111-1111-111111111111'
    const image = `ghcr.io/sailscastshq/slipway@sha256:${'c'.repeat(64)}`
    const plan = {
      instanceId: 'fixture-instance',
      sourceVersion: '0.0.88',
      reviewHash: 'a'.repeat(64),
      identity: { hash: 'b'.repeat(64), manifest: { version: '0.0.89', image } }
    }
    const mutations = []
    let accepted = false
    await page.raw.route('**/settings/update*', async (route) => {
      if (route.request().method() === 'POST') {
        mutations.push({
          body: route.request().postDataJSON(),
          inertia: route.request().headers()['x-inertia']
        })
        accepted = true
        return route.fulfill({
          status: 303,
          headers: { location: `/settings/update?upgradeId=${id}` },
          body: ''
        })
      }
      const response = await route.fetch(),
        source = await response.text()
      const isJson = response
        .headers()
        ['content-type']?.includes('application/json')
      const match = isJson
        ? null
        : source.match(
            /(<script[^>]*type="application\/json"[^>]*data-page="app"[^>]*>)([\s\S]*?)(<\/script>)/
          )
      const payload = JSON.parse(isJson ? source : match[2])
      Object.assign(payload.props, {
        coordinated: true,
        upgrade: accepted
          ? { id, phase: 'reviewed', recoveryRequired: false }
          : null,
        updateInfo: {
          currentVersion: '0.0.88',
          latestVersion: '0.0.89',
          updateAvailable: true,
          releaseNotes: '',
          publishedAt: null
        }
      })
      const json = JSON.stringify(payload)
      return route.fulfill({
        response,
        body: isJson
          ? json
          : source.replace(
              match[0],
              `${match[1]}${json.replace(/</g, '\\u003c')}${match[3]}`
            )
      })
    })
    await page.raw.route('**/api/v1/system/upgrade/plan', (route) =>
      route.fulfill({ json: plan })
    )
    await page.raw.route(`**/api/v1/system/upgrade/${id}`, (route) =>
      route.fulfill({
        json: {
          id,
          phase: 'ready',
          migration: {
            reconciled: true,
            pending: [],
            manifestHash: plan.identity.hash
          },
          image
        }
      })
    )
    await page.raw.route('**/health', (route) =>
      route.fulfill({
        json: {
          status: 'ok',
          version: '0.0.89',
          upgrade: { verified: true, image, manifestHash: plan.identity.hash }
        }
      })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto('/settings/update')
    const review = page.raw.getByRole('button', {
      name: 'Review upgrade',
      exact: true
    })
    await review.focus()
    await page.raw.keyboard.press('Enter')
    await page.raw
      .getByRole('button', { name: 'Apply reviewed upgrade', exact: true })
      .waitFor()
    expect(mutations.length).toBe(0)
    await page.raw
      .getByRole('button', { name: 'Apply reviewed upgrade', exact: true })
      .focus()
    await page.raw.keyboard.press('Enter')
    await page.raw.waitForURL('**/settings/update?upgradeId=*')
    expect(mutations.length).toBe(1)
    expect(mutations[0].inertia).toBe('true')
    expect(mutations[0].body.instanceId).toBe(plan.instanceId)
    expect(mutations[0].body.approval).toBe(plan.reviewHash)
  }
)
