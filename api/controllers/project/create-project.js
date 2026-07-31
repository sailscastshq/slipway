module.exports = {
  friendlyName: 'Create project',

  description: 'Create a new project for the current team.',

  inputs: {
    name: {
      type: 'string',
      required: true,
      description: 'The name of the project',
      example: 'My SaaS App'
    },
    description: {
      type: 'string',
      description: 'Optional description of the project'
    }
  },

  exits: {
    success: {
      responseType: 'redirect'
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ name, description }) {
    const userId = this.req.session.userId

    // Get the user's team
    const user = await User.findOne({ id: userId }).populate('team')

    if (!user || !user.team) {
      throw 'invalid'
    }

    const problems = sails.helpers.configuration.validate(
      { name, description },
      ['name']
    )
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
    if (!problems.length && (await Project.findOne({ slug }))) {
      problems.push({ name: 'A project with this name already exists.' })
    }
    if (problems.length) {
      throw { invalid: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    // Create the project
    const project = await Project.create({
      name,
      description: description || '',
      team: user.team.id,
      createdBy: userId
    }).fetch()

    // Auto-create a production environment
    const { telemetryToken, telemetryTokenHash } =
      sails.helpers.environment.generateTelemetryToken()
    await Environment.create({
      name: 'Production',
      slug: 'production',
      isProduction: true,
      telemetryToken,
      telemetryTokenHash,
      project: project.id
    })

    return `/projects/${project.slug}`
  }
}
