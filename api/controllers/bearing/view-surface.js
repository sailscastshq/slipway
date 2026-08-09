const {
  buildRealtimeConfig,
  serializeFeedback,
  serializeUpdate
} = require('../../lib/bearing-realtime')

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

    return {
      page: 'bearing/surface',
      props: {
        hostAssetBasePath: resolved.hostAssetBasePath,
        app: {
          name: resolved.project.name,
          homeUrl: resolved.homeUrl,
          feedbackPath: `${resolved.publicBasePath}/feedback`,
          roadmapPath: `${resolved.publicBasePath}/roadmap`,
          updatesPath: `${resolved.publicBasePath}/updates`,
          publicUrl: absoluteUrl(
            this.req,
            `${resolved.publicBasePath}/${surface}`
          ),
          ogImageUrl: absoluteUrl(
            this.req,
            `${resolved.publicBasePath}/${surface}/og.png`
          )
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
      }
    }
  }
}

function absoluteUrl(req, path) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host =
    req.get('x-forwarded-host') ||
    req.get('host') ||
    req.hostname ||
    'localhost'
  return `${protocol}://${host}${path}`
}
