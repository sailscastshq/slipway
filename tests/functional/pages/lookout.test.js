const crypto = require('node:crypto')
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

test(
  'failed Quest traces survive ingestion and appear in Lookout',
  {
    world: {
      name: 'configured-slipway',
      context: {
        deploymentTarget: {
          slug: 'lookout-quest-traces',
          name: 'Lookout Quest traces'
        }
      }
    }
  },
  async ({ sails, world, request, visit, expect }) => {
    const { projects, environments } = world.current
    const project = projects.deploymentTarget
    const environment = environments.production
    const token = 'stk_' + crypto.randomBytes(24).toString('hex')
    await sails.models.environment.updateOne({ id: environment.id }).set({
      telemetryToken: token,
      telemetryTokenHash: crypto
        .createHash('sha256')
        .update(token)
        .digest('hex')
    })

    const trace =
      'Error: database exploded\n    at sendIssueNotifications (/app/scripts/send-issue-notifications.js:12:3)'
    const response = await request
      .withHeaders({
        authorization: `Bearer ${token}`,
        accept: 'application/json'
      })
      .post('/api/v1/telemetry/ingest', {
        exceptions: [
          {
            exceptionType: 'QuestJobError',
            message: 'Job "send-issue-notifications" failed',
            stackTrace: trace,
            handled: true,
            occurredAt: Date.now()
          }
        ]
      })

    expect(response).toHaveStatus(200)
    const stored = await sails.models.telemetryexception.findOne({
      environment: environment.id,
      exceptionType: 'QuestJobError'
    })
    expect(stored.stackTrace).toBe(trace)

    const page = await visit.as('genesisUser')(
      `/projects/${project.slug}/environments/${environment.slug}/lookout`
    )
    expect(page).toHaveStatus(200)
    expect(page).toHaveInertiaProp(
      'telemetry.exceptions.groups.0.lastStackTrace',
      trace
    )
  }
)
