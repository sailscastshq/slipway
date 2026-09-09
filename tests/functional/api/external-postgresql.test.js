const { test } = require('sounding')
const { withCsrfFromPage } = require('../../support/csrf-request')
const assert = require('node:assert/strict')
const connection = require('../../../api/lib/external-postgresql')
test(
  'external PostgreSQL registration keeps credentials secret and rejects managed lifecycle operations',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'external-pg' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const browser = await withCsrfFromPage(request, '/', 'genesisUser')
    const root = '/api/v1/projects/external-pg/environments/production/services'
    const secret = 'external-private-password'
    const configuration = {
      dsn: `postgresql://backup:${secret}@database.example.com/application`
    }
    const response = await browser.request.post(root + '/external', {
      name: 'external-db',
      configuration
    })
    expect(response).toHaveStatus(201)
    const id = response.data.service.id
    expect(response.data.service.status).toBe('unverified')
    const raw = await sails.models.service.findOne({ id })
    expect(JSON.stringify(raw).includes(secret)).toBe(false)
    const service = await sails.models.service.findOne({ id }).decrypt()
    expect(service.managementMode).toBe('external')
    expect(service.containerName).toBe(null)
    expect(service.externalConnection.password).toBe(secret)
    const environment = await sails.models.environment
      .findOne({ id: service.environment })
      .decrypt()
    expect(environment.envVars.DATABASE_URL).toContain(secret)
    expect(environment.envVarMetadata.DATABASE_URL.kind).toBe('secret')
    for (const url of [
      `/api/v1/services/${id}`,
      '/api/v1/projects/external-pg/environments/production',
      '/projects/external-pg/environments/production/apps/web',
      '/projects/external-pg/environments/production',
      `/projects/external-pg/environments/production/services/${id}`
    ]) {
      const page = await browser.request.get(url, {
        headers: { 'X-Inertia': 'true' }
      })
      expect(page).toHaveStatus(200)
      expect(JSON.stringify(page.data).includes(secret)).toBe(false)
      expect(JSON.stringify(page.data).includes('externalConnection')).toBe(
        false
      )
    }
    for (const action of ['stop', 'restart'])
      expect(
        await browser.request.post(`/api/v1/services/${id}/${action}`, {})
      ).toHaveStatus(409)
    const updatedEnvironment = await browser.request.patch(
      '/api/v1/projects/external-pg/environments/production',
      {
        envVars: {
          ...environment.envVars,
          DATABASE_URL: connection.hidden,
          EXTRA: 'kept'
        }
      }
    )
    expect(updatedEnvironment).toHaveStatus(200)
    const preserved = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(preserved.envVars.DATABASE_URL).toBe(
      environment.envVars.DATABASE_URL
    )
    expect(preserved.envVars.EXTRA).toBe('kept')
    await sails.models.service.updateOne({ id }).set({
      status: 'reachable',
      externalVerification: {
        status: 'reachable',
        connectionFingerprint: 'old'
      }
    })
    expect(
      await browser.request.patch(`/api/v1/services/${id}/external`, {
        configuration: {
          dsn: `postgresql://backup:rotated-password@new.example.com/application`
        }
      })
    ).toHaveStatus(200)
    const rotated = await sails.models.service.findOne({ id }).decrypt()
    expect(rotated.status).toBe('unverified')
    expect(rotated.externalVerification.connectionFingerprint).toBe(undefined)
    expect(rotated.externalConnection.password).toBe('rotated-password')
    expect(
      await browser.request.patch(`/api/v1/services/${id}/external`, {
        configuration: { dsn: '', sslMode: 'verify-full', caCertificate: '' }
      })
    ).toHaveStatus(200)
    const retained = await sails.models.service.findOne({ id }).decrypt()
    expect(retained.externalConnection.password).toBe('rotated-password')
    const updated = await sails.models.environment
      .findOne({ id: environment.id })
      .decrypt()
    expect(updated.envVars.DATABASE_URL).toContain('rotated-password')
    expect(updated.envVars.EXTRA).toBe('kept')
    const logs = await sails.models.auditlog.find({ resourceId: String(id) })
    expect(JSON.stringify(logs).includes('rotated-password')).toBe(false)
    const disabledTls = await browser.request.post(root + '/external', {
      name: 'insecure-db',
      configuration: { ...configuration, sslMode: 'disable' }
    })
    expect(disabledTls).toHaveStatus(400)
    assert.throws(() =>
      connection.parse({
        dsn: 'postgresql://user:pass%0Ahost=evil@db.test/app'
      })
    )
    assert.throws(() =>
      connection.parse({ ...configuration, caCertificate: 'not a CA' })
    )
    const current = world.current.users.genesisUser
    const otherOwner = await world
      .create('user')
      .with({ email: 'external-owner@example.test' })
    await sails.models.team
      .updateOne({ id: world.current.teams.genesisTeam.id })
      .set({ owner: otherOwner.id })
    await sails.models.teammembership
      .updateOne({ user: current.id, team: world.current.teams.genesisTeam.id })
      .set({ role: 'member' })
    expect(
      await browser.request.post(root + '/external', {
        name: 'denied',
        configuration
      })
    ).toHaveStatus(403)
  }
)
