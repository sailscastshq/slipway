const { serializeUpdate } = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'View Bearing widget config',

  description:
    'Return the small public capability document consumed by the host widget.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },

  exits: {
    notFound: { statusCode: 404 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug }) {
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

    const updates = resolved.space.showPublicUpdates
      ? await sails.helpers.bearing.listUpdates.with({
          spaceId: String(resolved.space.id),
          status: 'published',
          limit: 1
        })
      : []

    const surfaces = {
      feedback: {
        label: 'Feedback',
        path: `${resolved.publicBasePath}/feedback?embedded=1`
      },
      roadmap: resolved.space.showPublicRoadmap
        ? {
            label: 'Roadmap',
            path: `${resolved.publicBasePath}/roadmap?embedded=1`
          }
        : null,
      updates: resolved.space.showPublicUpdates
        ? {
            label: 'Updates',
            path: `${resolved.publicBasePath}/updates?embedded=1`
          }
        : null
    }
    const openingView = surfaces[resolved.space.widgetOpeningView]
      ? resolved.space.widgetOpeningView
      : 'feedback'

    this.res.set('Cache-Control', 'private, no-store')
    return {
      enabled: resolved.space.widgetEnabled,
      appName: resolved.project.name,
      space: resolved.space.publicSlug,
      side: resolved.space.widgetSide,
      openingView,
      showUnread: resolved.space.showUnread,
      surfaces,
      latestUpdate: updates[0] ? serializeUpdate(updates[0]) : null
    }
  }
}
