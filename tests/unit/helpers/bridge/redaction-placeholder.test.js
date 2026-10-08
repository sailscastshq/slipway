const { test } = require('sounding')

for (const surface of ['create', 'edit']) {
  test(`Bridge ${surface} rejects redaction placeholders before target mutation`, async ({
    sails,
    expect
  }) => {
    const resource = {
      identity: 'sponsorshiptier',
      primaryKey: 'id',
      create: ['description', 'perks'],
      edit: ['description', 'perks'],
      attributes: { description: { type: 'string' }, perks: { type: 'json' } }
    }
    for (const values of [
      { description: 'Support [REDACTED] with visibility across the event.' },
      { perks: ['Logo', { text: 'Support [REDACTED]' }] }
    ]) {
      let rejected
      try {
        await sails.helpers.bridge.allowResourceValues.with({
          values,
          resource,
          surface
        })
      } catch (error) {
        rejected = error
      }
      expect(rejected?.code).toBe('BRIDGE_FIELD_INVALID')
      expect(rejected?.fieldErrors[Object.keys(values)[0]]).toContain(
        'redaction placeholder'
      )
    }
    const description =
      'Support Sailsconf 2026 with visibility across the event.'
    expect(
      await sails.helpers.bridge.allowResourceValues.with({
        values: { description },
        resource,
        surface
      })
    ).toEqual({ description })
  })
}
