module.exports = {
  friendlyName: 'Destroy project',

  description:
    'Run the shared, resumable cleanup for a project and its resources.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    purgeData: {
      type: 'boolean',
      defaultsTo: false,
      description:
        'Also purge retained volumes, backups, source, and Docker images.'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    notFound: {
      responseType: 'inertiaRedirect'
    }
  },

  fn: async function ({ slug, purgeData }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )
    const requestKey = `project:${slug}`
    const project = await Project.findOne({ slug, team: user.team.id })
    const targetKey = project ? `project:${project.id}` : undefined
    const existingOperation = await sails.helpers.cleanup.findOperation.with({
      targetKey,
      requestKey
    })

    if (
      !project &&
      (!existingOperation ||
        Number(existingOperation.team) !== Number(user.team.id))
    ) {
      throw { notFound: '/' }
    }

    try {
      const cleanup = await sails.helpers.cleanup.run.with({
        targetKey: targetKey || existingOperation.targetKey,
        requestKey,
        scopeType: 'project',
        resourceId: project?.id || existingOperation.resourceId,
        retentionPolicy: purgeData ? 'purge' : 'retain',
        userId: user.id,
        teamId: user.team.id,
        ipAddress: this.req.ip
      })
      const projectName = project?.name || cleanup.label || slug

      sails.inertia.flash({
        success: `Project "${projectName}" deleted.`,
        cleanup
      })
      return '/'
    } catch (error) {
      sails.inertia.flash({
        error:
          error.message ||
          'Project cleanup paused. Try deleting the project again to resume.',
        cleanup: error.cleanup || null
      })
      return project ? `/projects/${slug}/settings` : '/'
    }
  }
}
