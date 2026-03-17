/**
 * stream-jobs.js
 *
 * SSE endpoint that streams live Quest job state and recent run history.
 * Polls the container for job state and queries telemetry every 30s.
 */

module.exports = {
  friendlyName: 'Stream Quest jobs',

  description:
    'Server-Sent Events stream of live Quest job state and run history.',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      defaultsTo: 'production'
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

    const stream = res.sse()
    let lastPayloadHash = ''

    // Send initial data immediately, then poll every 30s
    await sendSnapshot()

    const interval = setInterval(() => {
      sendSnapshot().catch(() => {})
    }, 30000)

    stream.onClose(() => {
      clearInterval(interval)
    })

    async function sendSnapshot() {
      if (stream.closed) return

      try {
        // Get app + quest feature
        const app =
          (await App.findOne({
            environment: environment.id,
            isDefault: true
          })) || (await App.findOne({ environment: environment.id }))
        const hasQuestFeature = !!(
          environment.features && environment.features['sails-quest']
        )
        const questFeature = hasQuestFeature
          ? environment.features['sails-quest']
          : null

        let jobs = []
        let jobsError = null

        if (
          hasQuestFeature &&
          app &&
          app.status === 'running' &&
          app.containerName
        ) {
          try {
            const result = await sails.helpers.quest.listJobs(
              app.containerName,
              questFeature
            )
            jobs = result.jobs || []
            jobsError = result.error
          } catch (err) {
            jobsError = err.message
          }
        }

        let jobHistory = []
        try {
          jobHistory = await sails.helpers.quest.getJobHistory(environment.id)
        } catch {
          // Telemetry may not exist yet
        }

        // Skip sending if nothing changed
        const payload = { jobs, jobsError, jobHistory }
        const hash = JSON.stringify(payload)
        if (hash === lastPayloadHash) return
        lastPayloadHash = hash

        stream.send(payload)
      } catch (err) {
        stream.send({ error: err.message })
      }
    }

    return stream.wait()
  }
}
