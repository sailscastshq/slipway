module.exports = {
  friendlyName: 'Create environment',

  description: 'Create a new environment for a project from the web UI.',

  inputs: {
    slug: {
      type: 'string',
      required: true,
      description: 'Project slug'
    },
    name: {
      type: 'string',
      required: true,
      description: 'Environment name'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    notFound: {
      responseType: 'redirect'
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ slug, name }) {
    const user = await User.findOne({ id: this.req.session.userId }).populate(
      'team'
    )

    const project = await Project.findOne({ slug, team: user.team.id })

    if (!project) {
      throw { notFound: '/' }
    }

    const problems = sails.helpers.configuration.validate({ name }, ['name'])
    const environmentSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (
      !problems.length &&
      (await Environment.findOne({
        project: project.id,
        slug: environmentSlug
      }))
    ) {
      problems.push({
        name: 'An environment with this name already exists in this project.'
      })
    }
    if (problems.length) {
      throw { invalid: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const { telemetryToken, telemetryTokenHash } =
      sails.helpers.environment.generateTelemetryToken()
    await Environment.create({
      name,
      telemetryToken,
      telemetryTokenHash,
      project: project.id
    })

    return `/projects/${slug}`
  }
}
