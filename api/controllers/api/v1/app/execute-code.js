module.exports = {
  friendlyName: 'Execute code',

  description:
    'Execute JavaScript code inside a running app container (Helm REPL).',

  inputs: {
    projectSlug: {
      type: 'string',
      required: true
    },
    environmentSlug: {
      type: 'string',
      required: true
    },
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to execute'
    },
    executionId: {
      type: 'string',
      required: true,
      regex:
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    },
    sourceStartLine: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    },
    sourceStartColumn: {
      type: 'number',
      defaultsTo: 1,
      min: 1,
      max: 1000000
    },
    appSlug: {
      type: 'string',
      description: 'Target app slug (defaults to default app)'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({
    projectSlug,
    environmentSlug,
    code,
    executionId,
    sourceStartLine,
    sourceStartColumn,
    appSlug
  }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const project = await Project.findOne({ slug: projectSlug }).populate(
      'team'
    )

    if (!project) {
      throw 'notFound'
    }

    if (project.team.id !== user.team) {
      throw 'forbidden'
    }

    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })

    if (!environment) {
      throw 'notFound'
    }

    const app =
      (await App.findOne({ environment: environment.id, isDefault: true })) ||
      (await App.findOne({ environment: environment.id }))

    if (!app || app.status !== 'running' || !app.containerName) {
      throw { badRequest: 'App is not running.' }
    }

    const execution = sails.helpers.helm.beginExecution(
      executionId,
      this.req,
      this.res
    )

    try {
      return await sails.helpers.helm.executeInContainer(
        app.containerName,
        code,
        sourceStartLine,
        sourceStartColumn,
        executionId,
        execution.signal
      )
    } finally {
      execution.release()
    }
  }
}
