const { normalizeBearingCategories } = require('../../lib/bearing-categories')

module.exports = {
  friendlyName: 'View Bearing social image',

  description:
    'Render the current social preview for a public Bearing surface.',

  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    surface: {
      type: 'string',
      isIn: ['feedback', 'roadmap', 'updates'],
      required: true
    }
  },

  exits: { notFound: { statusCode: 404 } },

  fn: async function ({ projectSlug, environmentSlug, appSlug, surface }) {
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

    const criteria = { space: resolved.space.id }
    if (surface === 'roadmap') {
      criteria.status = { in: ['planned', 'in_progress'] }
    }

    const [items, itemCount] =
      surface === 'updates'
        ? await Promise.all([
            BearingUpdate.find({
              space: resolved.space.id,
              status: 'published'
            })
              .sort(['publishedAt DESC', 'id DESC'])
              .limit(1),
            BearingUpdate.count({
              space: resolved.space.id,
              status: 'published'
            })
          ])
        : await Promise.all([
            BearingFeedback.find(criteria)
              .sort(
                surface === 'feedback' ? 'voteCount DESC' : 'updatedAt DESC'
              )
              .limit(1),
            BearingFeedback.count(criteria)
          ])
    const item = items[0] || null
    const categories = normalizeBearingCategories(
      resolved.space.feedbackCategories
    )
    const image = await sails.helpers.bearing.renderSocialImage.with({
      appName: resolved.project.name,
      surface,
      item,
      itemCount,
      categoryLabel:
        categories.find((category) => category.key === item?.category)?.label ||
        ''
    })

    this.res.set(
      'Cache-Control',
      'public, max-age=300, stale-while-revalidate=86400'
    )
    this.res.type('png')
    return this.res.send(image)
  }
}
