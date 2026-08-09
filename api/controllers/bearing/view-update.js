const { serializeUpdate } = require('../../lib/bearing-realtime')

module.exports = {
  friendlyName: 'View public Bearing update',

  description: 'Render one published product update on its stable permalink.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    updateSlug: { type: 'string', required: true, maxLength: 180 }
  },

  exits: {
    success: { responseType: 'inertia' },
    notFound: { statusCode: 404 }
  },

  fn: async function ({ projectSlug, environmentSlug, appSlug, updateSlug }) {
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
    const ogImageUrl = absoluteUrl(this.req, `${publicPath}/og.png`)
    const canonicalUrl = absoluteUrl(this.req, publicPath)

    return {
      page: 'bearing/update',
      props: {
        hostAssetBasePath: resolved.hostAssetBasePath,
        app: {
          name: resolved.project.name,
          homeUrl: resolved.homeUrl,
          feedbackPath: `${resolved.publicBasePath}/feedback`,
          roadmapPath: `${resolved.publicBasePath}/roadmap`,
          updatesPath: `${resolved.publicBasePath}/updates`
        },
        bearing: {
          showPublicRoadmap: resolved.space.showPublicRoadmap,
          showPublicUpdates: resolved.space.showPublicUpdates
        },
        update: serializeUpdate({ ...update, linkedFeedback }),
        publicUrl: canonicalUrl,
        ogImageUrl
      },
      locals: {
        title: `${update.title} · ${resolved.project.name}`,
        description: update.excerpt,
        ogImage: ogImageUrl,
        canonicalUrl
      }
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

function absoluteUrl(req, path) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host =
    req.get('x-forwarded-host') ||
    req.get('host') ||
    req.hostname ||
    'localhost'
  return `${protocol}://${host}${path}`
}
