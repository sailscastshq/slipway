const {
  buildRealtimeConfig,
  serializeFeedback,
  serializeUpdate
} = require('../../lib/bearing-realtime')
const {
  buildBearingSocialMetadata
} = require('../../lib/bearing-social-metadata')

module.exports = {
  friendlyName: 'View public Bearing surface',

  description: 'Render an app-owned public roadmap or updates page.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    surface: {
      type: 'string',
      isIn: ['roadmap', 'updates'],
      required: true
    },
    embedded: {
      type: 'boolean',
      defaultsTo: false
    }
  },

  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    appSlug,
    surface,
    embedded
  }) {
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

    if (
      (surface === 'roadmap' && !resolved.space.showPublicRoadmap) ||
      (surface === 'updates' && !resolved.space.showPublicUpdates)
    ) {
      throw 'notFound'
    }

    const items =
      surface === 'updates'
        ? (
            await sails.helpers.bearing.listUpdates.with({
              spaceId: String(resolved.space.id),
              status: 'published',
              limit: 100
            })
          ).map(serializeUpdate)
        : (
            await BearingFeedback.find({
              space: resolved.space.id,
              status: { in: ['planned', 'in_progress'] }
            })
              .sort('updatedAt DESC')
              .limit(100)
          ).map(serializeFeedback)
    const title = surface === 'roadmap' ? 'Roadmap' : 'Updates'
    const description =
      surface === 'roadmap'
        ? `A clear look at what ${resolved.appearance.displayName} is considering and building next.`
        : `The useful things that recently changed in ${resolved.appearance.displayName}.`
    const social = buildBearingSocialMetadata({
      req: this.req,
      appName: resolved.appearance.displayName,
      path: `${resolved.publicBasePath}/${surface}`,
      imagePath: `${resolved.publicBasePath}/${surface}/og.png`,
      title: `${title} · ${resolved.appearance.displayName}`,
      description
    })

    return {
      page: 'bearing/surface',
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
          updatesPath: `${resolved.publicBasePath}/updates`,
          publicUrl: social.publicUrl,
          ogImageUrl: social.ogImageUrl
        },
        bearing: {
          showPublicRoadmap: resolved.space.showPublicRoadmap,
          showPublicUpdates: resolved.space.showPublicUpdates
        },
        realtime: buildRealtimeConfig({
          req: this.req,
          resolved,
          secret: sails.config.session.secret
        }),
        surface,
        embedded,
        items
      },
      locals: social.locals
    }
  }
}
