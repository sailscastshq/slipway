const { test } = require('sounding')

test(
  'Lookout exposes collector and retention health in its existing dashboard',
  { world: 'configured-slipway' },
  async ({ sails, visit, expect }) => {
    await sails.models.observabilityjobhealth.destroy({})
    const now = Date.now()
    await sails.models.observabilityjobhealth.createEach([
      {
        jobName: 'collector',
        lastAttemptAt: now - 1000,
        lastSuccessAt: now - 1000,
        lastDurationMs: 5,
        rowCount: 42,
        details: { recordedRows: 1 }
      },
      {
        jobName: 'retention',
        lastAttemptAt: now - 2000,
        lastSuccessAt: now - 2000,
        lastDurationMs: 10,
        rowCount: 120,
        details: { prune: { deletedRows: 4 } }
      }
    ])

    const page = await visit.as('genesisUser')('/lookout')

    expect(page).toHaveStatus(200)
    expect(page).toBeInertiaPage('lookout/index')
    expect(page).toHaveInertiaProp(
      'observabilityHealth.collector.status',
      'healthy'
    )
    expect(page).toHaveInertiaProp(
      'observabilityHealth.retention.rowCount',
      120
    )
  }
)
