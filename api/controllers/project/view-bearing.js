const { normalizeBearingCategories } = require('../../lib/bearing-categories')

module.exports = {
  friendlyName: 'View Bearing',

  description: 'Configure app-scoped Bearing feedback surfaces.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    view: {
      type: 'string',
      isIn: ['overview', 'feedback', 'roadmap', 'updates', 'settings'],
      defaultsTo: 'overview'
    }
  },

  exits: {
    success: { responseType: 'inertia' },
    notFound: { responseType: 'redirect' },
    forbidden: { responseType: 'redirect' }
  },

  fn: async function ({ slug, envSlug, appSlug, view }) {
    const resolved = await resolveManager(this.req, {
      slug,
      envSlug,
      appSlug
    })
    const { project, environment, app } = resolved
    const space = await BearingSpace.findOne({ app: app.id })
    let uploadsConfigured = true
    try {
      await sails.helpers.uploads.getStorageConfig()
    } catch {
      uploadsConfigured = false
    }
    const appUrl = await sails.helpers.bridge.getAppUrl.with({
      app,
      environment,
      project
    })
    const [feedback, attentionFeedback, updates, counts] = space
      ? await Promise.all([
          BearingFeedback.find({ space: space.id })
            .populate('author')
            .sort(['updatedAt DESC', 'id DESC'])
            .limit(100),
          BearingFeedback.find({ space: space.id, status: 'reviewing' })
            .populate('author')
            .sort(['voteCount DESC', 'updatedAt DESC', 'id DESC'])
            .limit(5),
          sails.helpers.bearing.listUpdates.with({
            spaceId: String(space.id),
            status: 'all',
            limit: 50
          }),
          loadCounts(space.id)
        ])
      : [[], [], [], emptyCounts()]

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
        activeView: view,
        feedback: feedback.map(serializeManagerFeedback),
        attentionFeedback: attentionFeedback.map(serializeManagerFeedback),
        updates: updates.map(serializeManagerUpdate),
        counts,
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

async function loadCounts(spaceId) {
  const [feedback, votes, planned, participants, publishedUpdates] =
    await Promise.all([
      BearingFeedback.count({ space: spaceId }),
      BearingFeedback.sum('voteCount').where({ space: spaceId }),
      BearingFeedback.count({ space: spaceId, status: 'planned' }),
      BearingParticipant.count({ space: spaceId }),
      BearingUpdate.count({ space: spaceId, status: 'published' })
    ])

  return {
    feedback,
    votes: Number(votes || 0),
    planned,
    participants,
    publishedUpdates
  }
}

function emptyCounts() {
  return {
    feedback: 0,
    votes: 0,
    planned: 0,
    participants: 0,
    publishedUpdates: 0
  }
}

function serializeManagerFeedback(item) {
  return {
    publicId: item.publicId,
    title: item.title,
    details: item.details,
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
