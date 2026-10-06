const { test } = require('sounding')
const image = `ghcr.io/sailscastshq/slipway@sha256:${'c'.repeat(64)}`
const command = `sudo bash scripts/upgrade-host-native.sh plan --bundle '<verified-host-bundle.tar.gz>' --bundle-sha256 '<verified-archive-sha256>' --image '${image}'`
async function hostPage(page, upgrade = null) {
  const mutations = []
  await page.raw.route('**/settings/update**', async (route) => {
    if (route.request().method() === 'POST') {
      mutations.push(route.request().url())
      return route.fulfill({
        status: 409,
        json: { code: 'unexpected-dispatch' }
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
      hostNative: true,
      upgrade,
      updateInfo: {
        currentVersion: '0.0.88',
        latestVersion: upgrade ? '0.0.88' : '0.0.89',
        updateAvailable: !upgrade,
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
  return mutations
}
async function open({ login, world, page }) {
  await login.withPassword('genesisUser', page, {
    password: world.current.auth.genesisUserPassword
  })
  await page.raw.waitForURL('**/')
  await page.goto('/settings/update')
}
test(
  'keyboard review shows the pinned host command and never dispatches an upgrade',
  { browser: true, world: 'configured-slipway' },
  async (ctx) => {
    const { page, expect } = ctx
    const mutations = await hostPage(page)
    await page.raw.route('**/api/v1/system/upgrade/plan', (route) =>
      route.fulfill({
        json: {
          execution: 'host-native',
          image,
          requiresVerifiedBundle: true,
          hostCommand: command,
          message: 'Automatic UI execution is not enabled.'
        }
      })
    )
    await open(ctx)
    const review = page.raw.getByRole('button', {
      name: 'Review host upgrade',
      exact: true
    })
    await review.focus()
    await page.raw.keyboard.press('Enter')
    const ready = page.raw.getByRole('button', {
      name: 'Host command ready',
      exact: true
    })
    await ready.waitFor()
    expect(await ready.isDisabled()).toBe(true)
    expect(
      await page.raw
        .locator('pre')
        .filter({ hasText: 'sudo bash scripts/upgrade-host-native.sh' })
        .innerText()
    ).toBe(command)
    expect(mutations.length).toBe(0)
  }
)
test(
  'saved host recovery displays its exact command without a web resume mutation or new plan',
  { browser: true, world: 'configured-slipway' },
  async (ctx) => {
    const { page, expect } = ctx
    const resume =
      command.replace(' plan ', ' resume ') +
      ` --checkpoint '/private/fixture-host.json' --instance 'fixture-instance' --approve-plan '${'a'.repeat(
        64
      )}'`
    const mutations = await hostPage(page, {
      id: 'fixture-id',
      instanceId: 'fixture-instance',
      reviewHash: 'a'.repeat(64),
      recoveryRequired: true,
      hostCommand: resume,
      execution: 'host-native'
    })
    let plans = 0
    await page.raw.route('**/api/v1/system/upgrade/plan', (route) => {
      plans++
      return route.fulfill({ status: 503, json: { code: 'unexpected-plan' } })
    })
    await open(ctx)
    await page.raw
      .getByText('Saved upgrade requires recovery', { exact: true })
      .waitFor()
    expect(
      await page.raw
        .locator('pre')
        .filter({ hasText: 'sudo bash scripts/upgrade-host-native.sh' })
        .innerText()
    ).toBe(resume)
    expect(
      await page.raw
        .getByRole('button', { name: 'Resume reviewed upgrade', exact: true })
        .count()
    ).toBe(0)
    expect(mutations.length).toBe(0)
    expect(plans).toBe(0)
  }
)
test(
  'failed host review is retryable by keyboard while the source stays online',
  { browser: true, world: 'configured-slipway' },
  async (ctx) => {
    const { page, expect } = ctx
    const mutations = await hostPage(page)
    let plans = 0
    await page.raw.route('**/api/v1/system/upgrade/plan', (route) => {
      plans++
      return route.fulfill(
        plans === 1
          ? {
              status: 503,
              json: { message: 'Upgrade plan could not be confirmed.' }
            }
          : {
              json: {
                execution: 'host-native',
                hostCommand: command,
                message: 'Automatic UI execution is not enabled.'
              }
            }
      )
    })
    await open(ctx)
    const review = page.raw.getByRole('button', {
      name: 'Review host upgrade',
      exact: true
    })
    await review.focus()
    await page.raw.keyboard.press('Enter')
    await page.raw
      .getByText('Upgrade plan could not be confirmed.', { exact: true })
      .waitFor()
    await page.raw
      .getByRole('button', { name: 'Try Again', exact: true })
      .focus()
    await page.raw.keyboard.press('Enter')
    await page.raw
      .getByRole('button', { name: 'Host command ready', exact: true })
      .waitFor()
    expect(plans).toBe(2)
    expect(mutations.length).toBe(0)
  }
)
