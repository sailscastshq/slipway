/**
 * stream-status.js
 *
 * SSE endpoint that streams backup status changes.
 * The run-backup helper publishes to `backup:${backupId}` on each
 * status transition (running → completed/failed).
 */

module.exports = {
  friendlyName: 'Stream backup status',

  description: 'Server-Sent Events stream for backup status updates.',

  inputs: {
    backupId: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      description: 'SSE stream started.'
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ backupId }) {
    const req = this.req
    const res = this.res

    const user = await User.findOne({ id: req.session.userId })
    if (!user) throw 'notFound'

    const backup = await Backup.findOne({ id: backupId })
    if (!backup) throw 'notFound'

    const service = await Service.findOne({ id: backup.service }).populate(
      'environment'
    )
    if (!service) throw 'notFound'

    const environment = await Environment.findOne({
      id: service.environment.id
    }).populate('project')
    const project = await Project.findOne({
      id: environment.project.id
    }).populate('team')
    if (project.team.id !== user.team) throw 'forbidden'

    // If already finished, send status and close immediately
    if (backup.status === 'completed' || backup.status === 'failed') {
      const stream = res.sse()
      stream.send({ status: backup.status })
      stream.close()
      return stream.wait()
    }

    return sails.sse.subscribe(req, res, `backup:${backupId}`)
  }
}
