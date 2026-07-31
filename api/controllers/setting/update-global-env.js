module.exports = {
  friendlyName: 'Update global environment',

  description: 'Update global environment variables.',

  inputs: {
    envVars: {
      type: 'json',
      required: true,
      description: 'Global environment variables as key-value object'
    },
    envSource: {
      type: 'string',
      description: 'Optional raw KEY=value input used to detect duplicate keys'
    },
    envVarMetadata: {
      type: 'json',
      defaultsTo: {},
      description: 'Non-secret type and preview metadata keyed by variable name'
    }
  },

  exits: {
    success: {
      responseType: 'inertiaRedirect'
    },
    forbidden: {
      statusCode: 403
    },
    invalid: {
      responseType: 'badRequest'
    },
    precognitionSuccess: {
      responseType: 'precognitionSuccess'
    }
  },

  fn: async function ({ envVars, envSource, envVarMetadata }) {
    const user = await User.findOne({ id: this.req.session.userId })

    // Only owners and admins can modify global env vars
    if (user.teamRole !== 'owner' && user.teamRole !== 'admin') {
      throw 'forbidden'
    }

    const problems = sails.helpers.setting.validate(
      { envVars, envSource },
      [],
      this.req
    )
    problems.push(
      ...sails.helpers.configuration.validateEnvVarMetadata(
        envVars,
        envVarMetadata
      )
    )
    if (problems.length) {
      throw { invalid: { problems } }
    }
    if (sails.inertia.isPrecognitive(this.req)) {
      throw 'precognitionSuccess'
    }

    const previousValuesJson = await sails.helpers.setting.get(
      'globalEnvVars',
      '{}'
    )
    const previousMetadataJson = await sails.helpers.setting.get(
      'globalEnvVarMetadata',
      '{}'
    )
    const previousValues = parseObject(previousValuesJson)
    const previousMetadata = parseObject(previousMetadataJson)
    const normalizedMetadata =
      sails.helpers.configuration.normalizeEnvVarMetadata.with({
        values: envVars,
        metadata: envVarMetadata,
        currentValues: previousValues,
        currentMetadata: previousMetadata,
        changedBy: String(user.id),
        changedByName: user.fullName
      })

    await sails.helpers.setting.set(
      'globalEnvVars',
      JSON.stringify(envVars),
      'Instance-wide environment variables injected into all deployed applications'
    )
    await sails.helpers.setting.set(
      'globalEnvVarMetadata',
      JSON.stringify(normalizedMetadata),
      'Non-secret metadata for instance-wide environment variables'
    )
    await sails.helpers.configuration.recordEnvVarChanges.with({
      before: previousValues,
      after: envVars,
      beforeMetadata: previousMetadata,
      afterMetadata: normalizedMetadata,
      scope: 'global',
      resourceType: 'setting',
      resourceId: 'globalEnvVars',
      userId: String(user.id),
      teamId: String(user.team),
      ipAddress: this.req.ip
    })

    return '/settings/global-env'
  }
}

function parseObject(value) {
  try {
    const parsed = JSON.parse(value || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {}
  } catch {
    return {}
  }
}
