module.exports = {
  friendlyName: 'Resolve runtime configuration',

  description:
    'Resolve global, environment, and app configuration using Slipway precedence.',

  inputs: {
    environmentId: { type: 'string', required: true },
    appId: { type: 'string' }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: async function ({ environmentId, appId }) {
    const [globalValuesJson, globalMetadataJson, environment, app] =
      await Promise.all([
        sails.helpers.setting.get('globalEnvVars', '{}'),
        sails.helpers.setting.get('globalEnvVarMetadata', '{}'),
        Environment.findOne({ id: environmentId }).decrypt(),
        appId ? App.findOne({ id: appId }).decrypt() : null
      ])

    const scopes = [
      {
        name: 'global',
        values: parseObject(globalValuesJson),
        metadata: parseObject(globalMetadataJson)
      },
      {
        name: 'environment',
        values: environment?.envVars || {},
        metadata: environment?.envVarMetadata || {}
      },
      {
        name: 'app',
        values: app?.secureEnvVars || app?.envVars || {},
        metadata: app?.envVarMetadata || {}
      }
    ]
    const values = {}
    const effective = {}

    for (const scope of scopes) {
      for (const [key, value] of Object.entries(scope.values)) {
        values[key] = value
        effective[key] = {
          key,
          scope: scope.name,
          ...safeMetadata(scope.metadata[key])
        }
      }
    }

    return {
      values,
      scopes,
      manifest: Object.values(effective).sort((a, b) =>
        a.key.localeCompare(b.key)
      )
    }
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

function safeMetadata(metadata = {}) {
  return {
    kind: metadata.kind === 'plain' ? 'plain' : 'secret',
    managed: metadata.managed === true,
    previewPolicy: ['inherit', 'omit', 'randomize'].includes(
      metadata.previewPolicy
    )
      ? metadata.previewPolicy
      : metadata.kind === 'plain'
      ? 'inherit'
      : 'omit'
  }
}
