const fs = require('node:fs')
const path = require('node:path')

const { test } = require('sounding')

const capturePhase = process.env.AVATAR_SCREENSHOT_PHASE || 'after'
const screenshotRoot = path.resolve(
  `.tmp/screenshots/issue-454-klean-avatar/${capturePhase}`
)
const teamLogo = `data:image/svg+xml;base64,${Buffer.from(
  `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="24" fill="#111827"/>
    <path d="M34 69c10 0 16-6 20-17 4 11 10 17 20 17 8 0 15-4 20-11-2 23-14 36-40 36S16 81 14 58c5 7 12 11 20 11Z" fill="#38bdf8"/>
    <circle cx="54" cy="38" r="8" fill="#f8fafc"/>
    <circle cx="74" cy="38" r="8" fill="#f8fafc"/>
  </svg>
`
).toString('base64')}`

test(
  'team identity preserves its visual contract with Klean Avatar',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })
    const current = world.current

    await prepareTeams({ sails, world })
    await preventUpdateCheck(page)
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(1440, 900)
    await page.inLightMode()
    await page.goto('/')

    const trigger = page.raw.locator('[data-test="desktop-team-selector"]')
    await trigger.click()
    await expect(page.raw.locator('#desktop-team-menu')).toBeVisible()
    await page.wait(100)
    await captureDesktop('desktop-team-menu-light.png', page)

    await page.inDarkMode()
    await page.wait(100)
    await captureDesktop('desktop-team-menu-dark.png', page)

    await page.inLightMode()
    await page.goto('/settings/team-profile')
    await page.wait(100)
    await page.screenshot(path.join(screenshotRoot, 'team-profile-light.png'), {
      animations: 'disabled'
    })

    await sails.models.team
      .updateOne({ id: current.teams.genesisTeam.id })
      .set({
        logoUrl: '/images/avatar-that-does-not-exist.svg'
      })
    await page.goto('/')
    await trigger.click()
    await page.wait(100)
    await captureDesktop('broken-image-fallback-light.png', page)

    if (capturePhase === 'after') {
      await expect(
        page.raw.locator('[data-test="desktop-current-team-avatar"]')
      ).toHaveAttribute('data-slot', 'avatar')
      await expect(
        page.raw.locator('[data-test="desktop-current-team-avatar"] img')
      ).toBeHidden()
      await expect(
        page.raw
          .locator('[data-test="desktop-current-team-avatar"]')
          .getByText('N', { exact: true })
      ).toBeVisible()
    }

    if (capturePhase === 'after') {
      expect(page).toHaveNoSmoke()
    }
  }
)

test(
  'team identity remains compact in the mobile drawer',
  { browser: true, world: 'configured-slipway' },
  async ({ sails, world, login, page, expect }) => {
    fs.mkdirSync(screenshotRoot, { recursive: true })
    const current = world.current

    await prepareTeams({ sails, world })
    await preventUpdateCheck(page)
    await login.withPassword('genesisUser', page, {
      password: current.auth.genesisUserPassword
    })
    await page.resize(390, 844)
    await page.inLightMode()
    await page.goto('/')

    await page.raw.locator('button.md\\:hidden').first().click()
    const trigger = page.raw.locator('[data-test="mobile-team-selector"]')
    await trigger.click()
    await expect(page.raw.locator('#mobile-team-menu')).toBeVisible()
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'mobile-team-menu-light.png'),
      { animations: 'disabled' }
    )

    await page.inDarkMode()
    await page.wait(100)
    await page.screenshot(
      path.join(screenshotRoot, 'mobile-team-menu-dark.png'),
      { animations: 'disabled' }
    )

    if (capturePhase === 'after') {
      await expect(
        page.raw.locator('[data-test="mobile-current-team-avatar"]')
      ).toHaveAttribute('data-slot', 'avatar')
    }

    expect(page).toHaveNoSmoke()
  }
)

async function prepareTeams({ sails, world }) {
  const current = world.current

  await sails.models.team.updateOne({ id: current.teams.genesisTeam.id }).set({
    name: 'Northstar Labs',
    logoUrl: teamLogo
  })
  await world.create('team').with({
    name: 'Quiet Current',
    slug: `${current.key}-quiet-current`,
    owner: current.users.genesisUser.id,
    logoUrl: ''
  })
}

async function preventUpdateCheck(page) {
  await page.raw.route('**/api/v1/system/check-update', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ updateAvailable: false })
    })
  })
  await page.raw.route(
    '**/images/avatar-that-does-not-exist.svg',
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: 'not an image'
      })
    }
  )
}

async function captureDesktop(fileName, page) {
  await page.raw.screenshot({
    path: path.join(screenshotRoot, fileName),
    animations: 'disabled',
    clip: { x: 0, y: 0, width: 430, height: 520 }
  })
}
