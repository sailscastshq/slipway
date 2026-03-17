module.exports = {
  friendlyName: 'Create preview environment',

  description:
    'Create a preview environment for a pull request, cloning envVars from production.',

  inputs: {
    project: {
      type: 'ref',
      required: true,
      description: 'Project record'
    },
    prNumber: {
      type: 'number',
      required: true,
      description: 'Pull request number'
    },
    branch: {
      type: 'string',
      required: true,
      description: 'PR branch name'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ project, prNumber, branch }) {
    const slug = `pr-${prNumber}`

    // Check if preview environment already exists
    const existing = await Environment.findOne({
      project: project.id,
      slug
    })

    if (existing) {
      sails.log.info(
        `Preview environment ${slug} already exists for ${project.slug}`
      )
      return existing
    }

    // Start with global env vars, then layer production env vars on top
    let envVars = {}
    try {
      const globalJson = await sails.helpers.setting.get('globalEnvVars', '{}')
      envVars = JSON.parse(globalJson)
    } catch {
      /* ignore parse errors */
    }

    const production = await Environment.findOne({
      project: project.id,
      isProduction: true
    }).decrypt()
    if (production) {
      envVars = { ...envVars, ...(production.envVars || {}) }
    }

    // Create the preview environment
    const { telemetryToken, telemetryTokenHash } =
      sails.helpers.environment.generateTelemetryToken()
    const environment = await Environment.create({
      name: `PR #${prNumber}`,
      slug,
      isProduction: false,
      isPreview: true,
      prNumber,
      envVars,
      telemetryToken,
      telemetryTokenHash,
      project: project.id
    }).fetch()

    sails.log.info(
      `Preview environment created: ${project.slug}/${slug} (branch: ${branch})`
    )

    return environment
  }
}
