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
    await page.raw.route('**/settings/update**', async (route) => {
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

test(
  'saved recovery is keyboard accessible and resumes its exact checkpoint without another plan',
  { browser: true, world: 'configured-slipway' },
  async ({ login, world, page, expect }) => {
    const id = '11111111-1111-1111-1111-111111111111'
    const receipt = {
      id,
      instanceId: 'fixture-instance',
      reviewHash: 'a'.repeat(64),
      manifestHash: 'b'.repeat(64),
      targetVersion: '0.0.89',
      image: `ghcr.io/sailscastshq/slipway@sha256:${'c'.repeat(64)}`,
      recoveryRequired: true
    }
    const mutations = []
    let plans = 0
    await page.raw.route('**/api/v1/system/upgrade/plan', (route) => {
      plans++
      return route.fulfill({ status: 503, json: { code: 'unexpected-plan' } })
    })
    await page.raw.route('**/settings/update**', async (route) => {
      if (route.request().method() === 'POST') {
        mutations.push({
          url: route.request().url(),
          body: route.request().postDataJSON(),
          inertia: route.request().headers()['x-inertia']
        })
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
        upgrade: receipt,
        updateInfo: {
          currentVersion: '0.0.88',
          latestVersion: '0.0.88',
          updateAvailable: false,
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
    await page.raw.route('**/health', (route) =>
      route.fulfill({ status: 503, json: { status: 'not-ready' } })
    )
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.raw.waitForURL('**/')
    await page.goto('/settings/update')
    const resume = page.raw.getByRole('button', {
      name: 'Resume reviewed upgrade',
      exact: true
    })
    await resume.focus()
    await page.raw.keyboard.press('Enter')
    await page.raw.waitForURL('**/settings/update?upgradeId=*')
    expect(mutations.length).toBe(1)
    expect(mutations[0].url.endsWith(`/settings/update/${id}/resume`)).toBe(
      true
    )
    expect(mutations[0].body.instanceId).toBe(receipt.instanceId)
    expect(mutations[0].body.approval).toBe(receipt.reviewHash)
    expect(mutations[0].inertia).toBe('true')
    expect(plans).toBe(0)
  }
)

test(
  'failed dispatch is reported while the previous healthy image remains online',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, login, world, page, expect }) => {
    const id = '11111111-1111-1111-1111-111111111111'
    const image = `ghcr.io/sailscastshq/slipway@sha256:${'c'.repeat(64)}`
    const plan = {
      instanceId: 'fixture-instance',
      sourceVersion: '0.0.88',
      reviewHash: 'a'.repeat(64),
      identity: { hash: 'b'.repeat(64), manifest: { version: '0.0.89', image } }
    }
    const upgradeAction = require('../../../api/lib/system-upgrade-action')
    const previousBroker = upgradeAction.broker
    const previousAdmission = sails.upgradeAdmission
    sails.upgradeAdmission = { verified: true }
    upgradeAction.broker = async () => ({
      latest: () => null,
      status: () => ({
        id,
        instanceId: plan.instanceId,
        reviewHash: plan.reviewHash,
        phase: 'reviewed',
        recoveryRequired: false
      }),
      start: async () => {}
    })
    try {
      const mutations = []
      let accepted = false
      await page.raw.route('**/settings/update**', async (route) => {
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
            phase: 'recoveryRequired',
            recoveryRequired: true,
            instanceId: plan.instanceId,
            reviewHash: plan.reviewHash,
            errorCode: 'upgradeFenceUnproved',
            errorReason: 'procUnobservable',
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
            version: '0.0.88',
            upgrade: {
              verified: true,
              image: 'old-image',
              manifestHash: 'old-manifest'
            }
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
      await page.raw
        .getByText('Saved upgrade requires recovery', { exact: true })
        .waitFor()
      expect(
        await page.raw
          .getByRole('button', { name: 'Resume reviewed upgrade', exact: true })
          .count()
      ).toBe(1)
      expect(
        await page.raw
          .getByRole('button', { name: 'Try Again', exact: true })
          .count()
      ).toBe(0)
    } finally {
      upgradeAction.broker = previousBroker
      if (previousAdmission === undefined) delete sails.upgradeAdmission
      else sails.upgradeAdmission = previousAdmission
    }
  }
)
