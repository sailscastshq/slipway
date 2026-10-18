const mail = require('../../lib/bearing-update-mail')
module.exports = {
  friendlyName: 'Update Bearing email preference',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true },
    embedded: { type: 'boolean', defaultsTo: false }
  },
  exits: {
    success: { responseType: 'bearingEmailPreferenceSaved' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 }
  },
  fn: async function (inputs) {
    let resolved
    try {
      resolved = await sails.helpers.bearing.resolvePublicRequest.with({
        req: this.req,
        projectSlug: inputs.projectSlug,
        environmentSlug: inputs.environmentSlug,
        appSlug: inputs.appSlug
      })
    } catch {
      throw 'notFound'
    }
    if (!resolved.participant || !resolved.space.showPublicUpdates)
      throw 'forbidden'
    const participant = await BearingParticipant.findOne({
      id: resolved.participant.id,
      space: resolved.space.id
    }).decrypt()
    if (!participant || participant.disabledAt || !participant.emailVerifiedAt)
      throw 'forbidden'
    const emailHash = mail.emailHash(participant.email)
    await sails.getDatastore().transaction(async (db) => {
      const current = await mail.latest(participant.id, db)
      const state = inputs.enabled ? 'on' : 'off'
      if (current?.state === state && current.emailHash === emailHash) return
      await BearingUpdateConsent.create({
        participant: participant.id,
        space: resolved.space.id,
        state,
        emailHash
      }).usingConnection(db)
    })
    return {
      enabled: inputs.enabled,
      location: `${resolved.publicBasePath}/updates${
        inputs.embedded ? '?embedded=1' : ''
      }`
    }
  }
}
