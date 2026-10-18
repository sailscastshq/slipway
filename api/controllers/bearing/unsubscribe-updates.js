const mail = require('../../lib/bearing-update-mail')
module.exports = {
  friendlyName: 'Unsubscribe from Bearing updates',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    token: { type: 'string', required: true, maxLength: 96 }
  },
  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
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
    const consent = await BearingUpdateConsent.findOne({
      id: Number(inputs.token.split('.')[0]) || -1,
      space: resolved.space.id
    })
    if (
      !consent ||
      !mail.validToken(inputs.token, consent, sails.config.session.secret)
    )
      throw 'notFound'
    let done = false
    if (this.req.method === 'POST') {
      await sails.getDatastore().transaction(async (db) => {
        const current = await mail.latest(consent.participant, db)
        if (current?.state === 'on' && current.emailHash === consent.emailHash)
          await BearingUpdateConsent.create({
            participant: consent.participant,
            space: consent.space,
            state: 'off',
            emailHash: consent.emailHash
          }).usingConnection(db)
      })
      done = true
    }
    this.res.set('Cache-Control', 'private, no-store')
    return {
      page: 'bearing/unsubscribe',
      props: {
        hostAssetBasePath: resolved.hostAssetBasePath,
        appName: resolved.project.name,
        updatesPath: `${resolved.publicBasePath}/updates`,
        postPath: `${resolved.publicBasePath}/unsubscribe`,
        done
      }
    }
  }
}
