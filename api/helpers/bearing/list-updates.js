module.exports = {
  friendlyName: 'List Bearing updates',

  description:
    'Load bounded Bearing updates with their explicitly linked feedback.',

  inputs: {
    spaceId: { type: 'string', required: true },
    status: {
      type: 'string',
      isIn: ['all', 'draft', 'published'],
      defaultsTo: 'all'
    },
    limit: { type: 'number', min: 1, max: 100, defaultsTo: 50 }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({ spaceId, status, limit }) {
    const criteria = { space: spaceId }
    if (status !== 'all') criteria.status = status

    const updates = await BearingUpdate.find(criteria)
      .sort(['publishedAt DESC', 'createdAt DESC', 'id DESC'])
      .limit(limit)
    if (!updates.length) return []

    const updateIds = updates.map((update) => update.id)
    const authorIds = [
      ...new Set(updates.map((update) => update.author).filter(Boolean))
    ]
    const authors = authorIds.length
      ? await User.find({ id: { in: authorIds } }).select([
          'id',
          'fullName',
          'initials'
        ])
      : []
    const authorsById = new Map(
      authors.map((author) => [String(author.id), author])
    )
    const links = await BearingUpdateLink.find({
      update: { in: updateIds },
      space: spaceId
    })
    const feedbackIds = [...new Set(links.map((link) => link.feedback))]
    const feedback = feedbackIds.length
      ? await BearingFeedback.find({ id: { in: feedbackIds }, space: spaceId })
      : []
    const feedbackById = new Map(
      feedback.map((item) => [String(item.id), item])
    )
    const linksByUpdate = new Map()
    for (const link of links) {
      const item = feedbackById.get(String(link.feedback))
      if (!item) continue
      const key = String(link.update)
      linksByUpdate.set(key, [...(linksByUpdate.get(key) || []), item])
    }

    return updates.map((update) => ({
      ...update,
      author: authorsById.get(String(update.author)) || null,
      linkedFeedback: linksByUpdate.get(String(update.id)) || []
    }))
  }
}
