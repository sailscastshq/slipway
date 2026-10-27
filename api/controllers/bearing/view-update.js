const { serializeUpdate } = require('../../lib/bearing-realtime')
const {
  buildBearingSocialMetadata
} = require('../../lib/bearing-social-metadata')

module.exports = {
  friendlyName: 'View public Bearing update',

  description: 'Render one published product update on its stable permalink.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    embedded: { type: 'boolean', defaultsTo: false },
    updateSlug: { type: 'string', required: true, maxLength: 180 }
  },

  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    appSlug,
    updateSlug,
    embedded
  }) {
    const resolved = await resolveRequest(this.req, {
      projectSlug,
      environmentSlug,
      appSlug
    })
    if (!resolved.space.showPublicUpdates) throw 'notFound'

    const update = await BearingUpdate.findOne({
      space: resolved.space.id,
      slug: updateSlug,
      status: 'published'
    }).populate('author')
    if (!update) throw 'notFound'

    const links = await BearingUpdateLink.find({
      update: update.id,
      space: resolved.space.id
    })
    const linkedFeedback = links.length
      ? await BearingFeedback.find({
          id: { in: links.map((link) => link.feedback) },
          space: resolved.space.id
        })
      : []
    const publicPath = `${
      resolved.publicBasePath
    }/updates/p/${encodeURIComponent(update.slug)}`
    const social = buildBearingSocialMetadata({
      req: this.req,
      appName: resolved.appearance.displayName,
      path: publicPath,
      imagePath: `${publicPath}/og.png`,
      title: `${update.title} · ${resolved.appearance.displayName}`,
      description: update.excerpt,
      type: 'article'
    })

    return {
      page: 'bearing/update',
      props: {
        hostAssetBasePath: resolved.hostAssetBasePath,
        appearance: {
          ...resolved.appearance,
          stylesheet: `${resolved.publicBasePath}/feedback/_/appearance.css`,
          resolvedMode:
            resolved.appearance.mode === 'host' &&
            embedded &&
            ['light', 'dark'].includes(this.req.query.appearanceMode)
              ? this.req.query.appearanceMode
              : null
        },
        app: {
          name: resolved.appearance.displayName,
          homeUrl: resolved.homeUrl,
          feedbackPath: `${resolved.publicBasePath}/feedback`,
          roadmapPath: `${resolved.publicBasePath}/roadmap`,
          updatesPath: `${resolved.publicBasePath}/updates`
        },
        bearing: {
          showPublicRoadmap: resolved.space.showPublicRoadmap,
          showPublicUpdates: resolved.space.showPublicUpdates
        },
        embedded,
        update: serializeUpdate({ ...update, linkedFeedback }),
        publicUrl: social.publicUrl,
        ogImageUrl: social.ogImageUrl
      },
      locals: social.locals
    }
  }
}

async function resolveRequest(req, inputs) {
  try {
    return await sails.helpers.bearing.resolvePublicRequest.with({
      req,
      ...inputs
    })
  } catch {
    throw 'notFound'
  }
}
