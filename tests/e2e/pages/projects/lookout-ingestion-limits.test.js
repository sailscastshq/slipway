const { test } = require('sounding')
const fs = require('node:fs')

test(
  'Lookout makes rejected telemetry visible',
  {
    browser: true,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ingestion-feedback' } }
    }
  },
  async ({ sails, world, login, page, expect }) => {
    await sails.models.telemetryingestionbudget.create({
      environment: String(world.current.environments.production.id),
      rejectedEvents: 250,
      rejectedRequests: 2
    })
    await login.withPassword('genesisUser', page, {
      password: world.current.auth.genesisUserPassword
    })
    await page.goto('/projects/ingestion-feedback/lookout')
    await expect(page).toSee(
      'Ingestion protection rejected 250 events across 2 requests.'
    )
    fs.mkdirSync('.github/screenshots/audit-telemetry-limits', {
      recursive: true
    })
    await page.screenshot(
      '.github/screenshots/audit-telemetry-limits/rejections.png',
      { fullPage: true, animations: 'disabled' }
    )
  }
)
