const { normalizeBearingCategories } = require('../../lib/bearing-categories')
const {
  buildRealtimeConfig,
  serializeFeedback
} = require('../../lib/bearing-realtime')
const { voteKey } = require('../../lib/bearing-votes')

module.exports = {
  friendlyName: 'View public Bearing feedback',

  description: 'Render an app-owned public feedback board.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    publicId: { type: 'string', maxLength: 40 },
    embedded: { type: 'boolean', defaultsTo: false },
    page: { type: 'number', min: 1, defaultsTo: 1 },
    q: { type: 'string', maxLength: 100, defaultsTo: '' },
    category: { type: 'string', maxLength: 40, defaultsTo: 'all' },
    status: {
      type: 'string',
      isIn: [
        'active',
        'all',
        'reviewing',
        'planned',
        'in_progress',
        'shipped',
        'closed'
      ],
      defaultsTo: 'active'
    },
    sort: {
      type: 'string',
      isIn: ['top', 'newest'],
      defaultsTo: 'top'
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
    publicId,
    embedded,
    page,
    q,
    category,
    status,
    sort
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

    const feedbackLoadedAt = Date.now()
    const focusedFeedback = publicId
      ? await BearingFeedback.findOne({
          publicId,
          space: resolved.space.id
        }).populate('author')
      : null

    if (publicId && !focusedFeedback) throw 'notFound'

    const categories = normalizeBearingCategories(
      resolved.space.feedbackCategories
    )
    const filters = normalizeFilters({ q, category, status, sort, categories })
    const criteria = buildCriteria({
      spaceId: resolved.space.id,
      filters
    })
    const perPage = 20
    const pageIndex = page - 1
    const total = await BearingFeedback.count(criteria)
    const feedback = await BearingFeedback.find(criteria)
      .populate('author')
      .sort(
        filters.sort === 'newest'
          ? ['createdAt DESC', 'id DESC']
          : ['voteCount DESC', 'createdAt DESC', 'id DESC']
      )
      .limit(perPage)
      .skip(pageIndex * perPage)

    if (
      pageIndex === 0 &&
      focusedFeedback &&
      !feedback.some((item) => item.id === focusedFeedback.id)
    ) {
      feedback.unshift(focusedFeedback)
    }

    const voter = await sails.helpers.bearing.resolveVoter.with({
      req: this.req,
      resolved,
      createAnonymous: false
    })
    const votedFeedbackIds = await findVotedFeedbackIds({
      feedback,
      voter,
      spaceId: resolved.space.id
    })
    const serializedFeedback = feedback.map((item) =>
      serializeFeedback(item, {
        viewerHasVoted: votedFeedbackIds.has(String(item.id))
      })
    )

    return {
      page: 'bearing/feedback',
      props: {
        hostAssetBasePath: resolved.hostAssetBasePath,
        app: {
          name: resolved.project.name,
          feedbackPath: `${resolved.publicBasePath}/feedback`,
          roadmapPath: `${resolved.publicBasePath}/roadmap`,
          updatesPath: `${resolved.publicBasePath}/updates`,
          identityPath: `${resolved.publicBasePath}/_slipway/bearing/identity`,
          ogImageUrl: absoluteUrl(
            this.req,
            `${resolved.publicBasePath}/feedback/og.png`
          )
        },
        bearing: {
          acceptFeedback: resolved.space.acceptFeedback,
          allowAnonymousParticipation:
            resolved.space.allowAnonymousParticipation,
          categories,
          showPublicRoadmap: resolved.space.showPublicRoadmap,
          showPublicUpdates: resolved.space.showPublicUpdates
        },
        participant: resolved.participant
          ? {
              id: resolved.participant.id,
              displayName: resolved.participant.displayName
            }
          : null,
        viewer: {
          canVote: Boolean(
            resolved.participant || resolved.space.allowAnonymousParticipation
          )
        },
        realtime: buildRealtimeConfig({
          req: this.req,
          resolved,
          projectSlug,
          environmentSlug,
          appSlug,
          secret: sails.config.session.secret
        }),
        focusedFeedbackId: focusedFeedback?.publicId || null,
        embedded,
        feedbackLoadedAt,
        filters,
        feedback: sails.inertia.scroll(() => serializedFeedback, {
          page: pageIndex,
          perPage,
          total,
          matchOn: 'publicId'
        })
      }
    }
  }
}

async function findVotedFeedbackIds({ feedback, voter, spaceId }) {
  if (!voter || feedback.length === 0) return new Set()

  const feedbackIds = feedback.map((item) => item.id)
  const criteria = voter.participantId
    ? {
        participant: voter.participantId,
        feedback: { in: feedbackIds },
        space: spaceId
      }
    : {
        voterKey: {
          in: feedback.map((item) => voteKey(item.id, voter.identityKey))
        },
        space: spaceId
      }
  const votes = await BearingVote.find(criteria).select(['feedback'])
  return new Set(votes.map((vote) => String(vote.feedback)))
}

function normalizeFilters({ q, category, status, sort, categories }) {
  const activeCategoryKeys = new Set(
    categories.filter((item) => item.active).map((item) => item.key)
  )

  return {
    q: String(q || '')
      .trim()
      .slice(0, 100),
    category: activeCategoryKeys.has(category) ? category : 'all',
    status,
    sort
  }
}

function buildCriteria({ spaceId, filters }) {
  const criteria = { space: spaceId }

  if (filters.category !== 'all') {
    criteria.category = filters.category
  }

  if (filters.status === 'active') {
    criteria.status = { '!=': 'closed' }
  } else if (filters.status !== 'all') {
    criteria.status = filters.status
  }

  if (filters.q) {
    criteria.or = [
      { title: { contains: filters.q } },
      { details: { contains: filters.q } }
    ]
  }

  return criteria
}

function absoluteUrl(req, path) {
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'https'
  const host = req.get('x-forwarded-host') || req.get('host')
  return `${protocol}://${host}${path}`
}
