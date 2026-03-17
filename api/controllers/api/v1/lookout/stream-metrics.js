/**
 * stream-metrics.js
 *
 * SSE endpoint that streams live container metrics for an environment.
 * Clients receive small data-point messages (~200 bytes per container)
 * every 30 seconds instead of re-fetching the entire Lookout page.
 */

module.exports = {
  friendlyName: 'Stream metrics',

  description:
    'Server-Sent Events stream of live container metrics for an environment.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    },
    notFound: {
      statusCode: 404,
      description: 'Project or environment not found.'
    }
  },

  fn: async function ({ projectSlug, environmentSlug }) {
    const req = this.req
    const res = this.res

    const user = await User.findOne({ id: req.session.userId }).populate('team')
    if (!user) throw 'notFound'

    const project = await Project.findOne({
      slug: projectSlug,
      team: user.team.id
    })
    if (!project) throw 'notFound'

    const environment = await Environment.findOne({
      slug: environmentSlug,
      project: project.id
    })
    if (!environment) throw 'notFound'

    return sails.sse.subscribe(req, res, `lookout:env:${environment.id}`)
  }
}
