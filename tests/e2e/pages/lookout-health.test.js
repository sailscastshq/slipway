const { test } = require('sounding')

test(
  'Lookout keeps observability health compact in light and dark mode',
  {
    browser: true,
    world: 'configured-slipway'
  },
  async ({ sails, world, login, page, expect }) => {
    const originalDisk = sails.helpers.lookout.getDiskSpace
    const now = Date.now()
    const getDiskSpace = async () => ({
      totalBytes: 1000,
      usedBytes: 240,
      availableBytes: 760,
      usedPercent: 24,
      mount: '/',
      total: '100 GB',
      used: '24 GB',
      available: '76 GB'
    })
    getDiskSpace.with = getDiskSpace
    sails.helpers.lookout.getDiskSpace = getDiskSpace

    await sails.models.observabilityjobhealth.destroy({})
    await sails.models.observabilityjobhealth.createEach([
      {
        jobName: 'collector',
        lastAttemptAt: now - 1000,
        lastSuccessAt: now - 1000,
        lastDurationMs: 5,
        rowCount: 1220,
        details: { recordedRows: 1 }
      },
      {
        jobName: 'retention',
        lastAttemptAt: now - 2000,
        lastSuccessAt: now - 2000,
        lastDurationMs: 10,
        rowCount: 1220,
        details: { prune: { deletedRows: 4 } }
      }
    ])

    try {
      await login.withPassword('genesisUser', page, {
        password: world.current.auth.genesisUserPassword
      })
      await page.raw.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 10000
      })

      await page.resize(1440, 900)
      await page.goto('/lookout')
      await page.wait('@lookout-observability-health')
      await expect(page).toSee('Collector just now')
      await expect(page).toSee('Retention just now')
      await expect(page).toSee('1.2k retained rows')
      await page.screenshot('.tmp/lookout-health-light.png', {
        fullPage: true
      })

      await page.raw.emulateMedia({ colorScheme: 'dark' })
      await page.screenshot('.tmp/lookout-health-dark.png', {
        fullPage: true
      })
      await page.raw.emulateMedia({ colorScheme: 'light' })

      expect(page).toHaveNoSmoke()
    } finally {
      sails.helpers.lookout.getDiskSpace = originalDisk
    }
  }
)
