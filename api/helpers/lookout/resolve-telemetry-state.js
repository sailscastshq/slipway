const MINIMUM_REGISTRATION_VERSION = '0.0.9'
const SUPPORTED_PROTOCOL_VERSION = 1

module.exports = {
  friendlyName: 'Resolve telemetry state',

  description:
    'Describe detected, connected, quiet, stale, disabled, and incompatible Lookout telemetry without using retained event volume as installation state.',

  sync: true,

  inputs: {
    detectedFeature: { type: 'ref' },
    connection: { type: 'ref' },
    currentDeploymentId: { type: 'string' },
    hasRecentData: { type: 'boolean', defaultsTo: false },
    now: { type: 'number', required: true },
    staleAfterMs: { type: 'number', required: true }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({
    detectedFeature,
    connection,
    currentDeploymentId,
    hasRecentData,
    now,
    staleAfterMs
  }) {
    const detectedVersion = detectedFeature?.version || null
    const common = {
      detectedVersion,
      hookVersion: connection?.hookVersion || null,
      protocolVersion: connection?.protocolVersion || null,
      capabilities: connection?.capabilities || {},
      startedAt: connection?.startedAt || null,
      lastSeenAt: connection?.lastSeenAt || null,
      staleAfterMs,
      currentDeploymentId: currentDeploymentId || null,
      registeredDeploymentId: connection?.deployment || null
    }

    if (!detectedFeature) {
      return state('not_detected', common)
    }

    const compatibleConnection =
      connection &&
      Number(connection.protocolVersion) === SUPPORTED_PROTOCOL_VERSION

    if (!compatibleConnection) {
      if (
        detectedVersion &&
        compareVersions(
          extractVersion(detectedVersion),
          MINIMUM_REGISTRATION_VERSION
        ) < 0
      ) {
        return state('incompatible', common)
      }
      return state('redeploy_required', common)
    }

    if (connection.enabled === false) {
      return state('disabled', common)
    }

    if (
      currentDeploymentId &&
      connection.deployment &&
      String(connection.deployment) !== String(currentDeploymentId)
    ) {
      return state('redeploy_required', common)
    }

    if (
      !connection.lastSeenAt ||
      now - Number(connection.lastSeenAt) > staleAfterMs
    ) {
      return state('stale', common)
    }

    return state(hasRecentData ? 'receiving' : 'connected_quiet', common)
  }
}

function state(value, details) {
  return { state: value, ...details }
}

function extractVersion(value) {
  const match = String(value || '').match(/\d+\.\d+\.\d+/)
  return match ? match[0] : '0.0.0'
}

function compareVersions(left, right) {
  const leftParts = String(left).split('.').map(Number)
  const rightParts = String(right).split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0)
    if (difference !== 0) return Math.sign(difference)
  }
  return 0
}
