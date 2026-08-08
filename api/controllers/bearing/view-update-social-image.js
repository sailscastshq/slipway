module.exports = {
  friendlyName: 'View Bearing update social image',

  description: 'Render a programmatic social image for one published update.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    updateSlug: { type: 'string', required: true, maxLength: 180 }
  },

  exits: { notFound: { statusCode: 404 } },

  fn: async function ({ projectSlug, environmentSlug, appSlug, updateSlug }) {
    let resolved
    try {
      resolved = await sails.helpers.bearing.resolvePublicRequest.with({
        req: this.req,
        projectSlug,
        environmentSlug,
        appSlug
      })
    } catch {
      throw 'notFound'
    }
    if (!resolved.space.showPublicUpdates) throw 'notFound'

    const update = await BearingUpdate.findOne({
      space: resolved.space.id,
      slug: updateSlug,
      status: 'published'
    })
    if (!update) throw 'notFound'

    const image = await sails.helpers.bearing.renderSocialImage.with({
      appName: resolved.project.name,
      surface: 'updates',
      item: update,
      itemCount: 1
    })

    this.res.set(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=86400'
    )
    this.res.type('png')
    return this.res.send(image)
  }
}
