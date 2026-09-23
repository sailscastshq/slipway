const { normalizeBearingCategories } = require('../../lib/bearing-categories')

module.exports = {
  friendlyName: 'View Bearing',

  description: 'Configure app-scoped Bearing feedback surfaces.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', maxLength: 40 }
  },

  exits: {
    success: { responseType: 'inertia' },
    notFound: { responseType: 'redirect' },
    forbidden: { responseType: 'redirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, publicId }) {
    const resolved = await resolveManager(this.req, {
      slug,
      envSlug,
      appSlug
    })
    const { project, environment, app } = resolved
    const space = await BearingSpace.findOne({ app: app.id })
    let uploadsConfigured = true
    try {
      await sails.helpers.uploads.getStorageConfig.with({
        requirePublicUrl: true
      })
    } catch {
      uploadsConfigured = false
    }
    const appUrl = await sails.helpers.bridge.getAppUrl.with({
      app,
      environment,
      project
    })
    const [feedback, updates] = space
      ? await Promise.all([
          BearingFeedback.find({ space: space.id })
            .populate('author')
            .sort(['updatedAt DESC', 'id DESC'])
            .limit(100),
          sails.helpers.bearing.listUpdates.with({
            spaceId: String(space.id),
            status: 'all',
            limit: 50
          })
        ])
      : [[], []]

    const focusedFeedback =
      publicId && space
        ? await BearingFeedback.findOne({ publicId, space: space.id }).populate(
            'author'
          )
        : null
    if (publicId && !focusedFeedback)
      throw { notFound: `${this.req.path}?view=feedback` }

    return {
      page: 'projects/bearing',
      props: {
        project: pick(project, ['id', 'name', 'slug']),
        environment: pick(environment, [
          'id',
          'name',
          'slug',
          'features',
          'isProduction'
        ]),
        app: {
          ...pick(app, ['id', 'name', 'slug', 'routePath', 'status']),
          appUrl
        },
        bearing: serializeSpace(space, app),
        focusedFeedback: focusedFeedback
          ? serializeManagerFeedback(focusedFeedback)
          : null,
        feedback: feedback.map(serializeManagerFeedback),
        updates: updates.map(serializeManagerUpdate),
        publicUrls: appUrl
          ? {
              feedback: `${appUrl}/bearing/feedback`,
              roadmap: `${appUrl}/bearing/roadmap`,
              updates: `${appUrl}/bearing/updates`
            }
          : null,
        uploadsConfigured,
        hookDetected: Boolean(environment.features?.['sails-hook-slipway'])
      }
    }
  }
}

function serializeManagerFeedback(item) {
  return {
    publicId: item.publicId,
    title: item.title,
    details: item.details,
    images: item.images || [],
    category: item.category,
    status: item.status,
    voteCount: item.voteCount,
    authorName: item.submittedAnonymously
      ? 'Anonymous'
      : item.author?.displayName || 'A customer',
    updatedAt: item.updatedAt
  }
}

function serializeManagerUpdate(item) {
  return {
    publicId: item.publicId,
    title: item.title,
    slug: item.slug,
    excerpt: item.excerpt,
    body: item.body,
    status: item.status,
    publishedAt: item.publishedAt,
    linkedFeedback: item.linkedFeedback.map((feedback) => ({
      publicId: feedback.publicId,
      title: feedback.title
    }))
  }
}

async function resolveManager(req, { slug, envSlug, appSlug }) {
  try {
    return await sails.helpers.bearing.resolveManager.with({
      req,
      projectSlug: slug,
      environmentSlug: envSlug,
      appSlug
    })
  } catch (error) {
    if (error.code === 'forbidden') throw { forbidden: '/' }
    throw { notFound: '/' }
  }
}

function serializeSpace(space, app) {
  return {
    enabled: app.bearingEnabled ?? false,
    acceptFeedback: space?.acceptFeedback ?? true,
    allowAnonymousParticipation: space?.allowAnonymousParticipation ?? false,
    feedbackCategories: normalizeBearingCategories(space?.feedbackCategories),
    showPublicRoadmap: space?.showPublicRoadmap ?? true,
    showPublicUpdates: space?.showPublicUpdates ?? true,
    widgetEnabled: space?.widgetEnabled ?? false,
    widgetSide: space?.widgetSide || 'right',
    widgetOpeningView: space?.widgetOpeningView || 'updates',
    showUnread: space?.showUnread ?? true
  }
}

function pick(value, keys) {
  return Object.fromEntries(keys.map((key) => [key, value[key]]))
}
