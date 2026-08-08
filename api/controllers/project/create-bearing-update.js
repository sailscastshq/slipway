const crypto = require('node:crypto')
const {
  serializeFeedback,
  serializeUpdate
} = require('../../lib/bearing-realtime')
const { createUpdateSlug } = require('../../lib/bearing-updates')

module.exports = {
  friendlyName: 'Create Bearing update',

  description:
    'Save or publish one product update and atomically ship linked feedback.',

  inputs: {
    slug: { type: 'string', required: true },
    envSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    title: { type: 'string', required: true, maxLength: 140 },
    excerpt: { type: 'string', required: true, maxLength: 280 },
    body: { type: 'string', required: true, maxLength: 10000 },
    feedbackIds: { type: 'ref', defaultsTo: [] },
    publish: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: { responseType: 'inertiaRedirect' },
    badRequest: { responseType: 'badRequest' },
    notFound: { responseType: 'inertiaRedirect' },
    forbidden: { responseType: 'inertiaRedirect' }
  },

  fn: async function (inputs) {
    const resolved = await resolveManager(this.req, inputs)
    const space = await BearingSpace.findOne({ app: resolved.app.id })
    if (!space) throw { notFound: bearingPath(inputs) }

    const title = String(inputs.title || '').trim()
    const excerpt = String(inputs.excerpt || '').trim()
    const body = String(inputs.body || '').trim()
    if (!title || !excerpt || !body) {
      throw {
        badRequest: {
          problems: [{ update: 'Add a title, summary, and useful details.' }]
        }
      }
    }

    const requestedIds = normalizeIds(inputs.feedbackIds)
    const linkedFeedback = requestedIds.length
      ? await BearingFeedback.find({
          publicId: { in: requestedIds },
          space: space.id,
          app: resolved.app.id
        })
      : []
    if (linkedFeedback.length !== requestedIds.length) {
      throw {
        badRequest: {
          problems: [
            { feedbackIds: 'Choose feedback from this Bearing space.' }
          ]
        }
      }
    }

    let update
    const now = Date.now()
    const updateSlug = await createUpdateSlug({
      title,
      spaceId: space.id
    })
    await sails.getDatastore().transaction(async (db) => {
      update = await BearingUpdate.create({
        title,
        slug: updateSlug,
        excerpt,
        body,
        status: inputs.publish ? 'published' : 'draft',
        publishedAt: inputs.publish ? now : null,
        author: resolved.user.id,
        space: space.id,
        app: resolved.app.id
      })
        .fetch()
        .usingConnection(db)

      if (linkedFeedback.length) {
        await BearingUpdateLink.createEach(
          linkedFeedback.map((feedback) => ({
            linkKey: crypto
              .createHash('sha256')
              .update(`${String(update.id)}:${String(feedback.id)}`)
              .digest('hex'),
            update: update.id,
            feedback: feedback.id,
            space: space.id
          }))
        ).usingConnection(db)
      }

      if (inputs.publish && linkedFeedback.length) {
        await BearingFeedback.update({
          id: { in: linkedFeedback.map((feedback) => feedback.id) },
          space: space.id
        })
          .set({ status: 'shipped' })
          .usingConnection(db)
      }
    })

    const publicUpdate = serializeUpdate({
      ...update,
      author: resolved.user,
      linkedFeedback
    })
    if (inputs.publish) {
      await broadcastPublished({ space, linkedFeedback, publicUpdate })
    }
    await logUpdate({
      req: this.req,
      resolved,
      update,
      publish: inputs.publish
    })

    sails.inertia.flash(
      'success',
      inputs.publish ? 'Update published.' : 'Update saved as a draft.'
    )
    return `${bearingPath(inputs)}?view=updates`
  }
}

async function broadcastPublished({ space, linkedFeedback, publicUpdate }) {
  for (const feedback of linkedFeedback) {
    await sails.helpers.bearing.broadcastFeedback.with({
      spaceId: String(space.id),
      verb: 'updated',
      feedback: serializeFeedback({ ...feedback, status: 'shipped' })
    })
  }
  await sails.helpers.bearing.broadcastUpdate.with({
    spaceId: String(space.id),
    verb: 'published',
    update: publicUpdate
  })
}

async function logUpdate({ req, resolved, update, publish }) {
  await sails.helpers.audit.log.with({
    action: publish ? 'bearing.update.published' : 'bearing.update.drafted',
    resourceType: 'bearing_update',
    resourceId: String(update.id),
    userId: String(resolved.user.id),
    teamId: String(resolved.user.team),
    ipAddress: req.ip,
    details: { appId: String(resolved.app.id) }
  })
}

async function resolveManager(req, inputs) {
  try {
    return await sails.helpers.bearing.resolveManager.with({
      req,
      projectSlug: inputs.slug,
      environmentSlug: inputs.envSlug,
      appSlug: inputs.appSlug
    })
  } catch (error) {
    if (error.code === 'forbidden') throw { forbidden: '/' }
    throw { notFound: '/' }
  }
}

function normalizeIds(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 100)
    )
  ]
}

function bearingPath({ slug, envSlug, appSlug }) {
  return `/projects/${slug}/environments/${envSlug}/apps/${appSlug}/bearing`
}
