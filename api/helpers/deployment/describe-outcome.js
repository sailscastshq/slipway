const ACTIVE_LABELS = {
  pending: 'Queued',
  building: 'Building',
  pushing: 'Publishing',
  deploying: 'Deploying'
}
const SUCCESS_STATUSES = ['running', 'stopped', 'success']

module.exports = {
  friendlyName: 'Describe deployment outcome',

  description:
    'Keep deployment lifecycle state separate from the release that currently owns traffic.',

  sync: true,

  inputs: {
    deployment: {
      type: 'ref',
      required: true
    },
    currentDeploymentIds: {
      type: 'ref',
      defaultsTo: []
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: function ({ deployment, currentDeploymentIds }) {
    const currentIds = new Set(
      (Array.isArray(currentDeploymentIds) ? currentDeploymentIds : [])
        .map(Number)
        .filter(Number.isFinite)
    )
    const isCurrent = currentIds.has(Number(deployment.id))
    const status = deployment.status

    if (isCurrent) {
      return {
        status,
        outcome: 'current',
        outcomeLabel: 'Current',
        isCurrent: true,
        isActive: false
      }
    }

    if (ACTIVE_LABELS[status]) {
      return {
        status,
        outcome: 'in-progress',
        outcomeLabel: ACTIVE_LABELS[status],
        isCurrent: false,
        isActive: true
      }
    }

    if (SUCCESS_STATUSES.includes(status)) {
      return {
        status,
        outcome: 'succeeded',
        outcomeLabel: 'Succeeded',
        isCurrent: false,
        isActive: false
      }
    }

    if (status === 'failed') {
      return {
        status,
        outcome: 'failed',
        outcomeLabel: 'Failed',
        isCurrent: false,
        isActive: false
      }
    }

    if (status === 'cancelled') {
      return {
        status,
        outcome: 'cancelled',
        outcomeLabel: 'Cancelled',
        isCurrent: false,
        isActive: false
      }
    }

    return {
      status,
      outcome: 'neutral',
      outcomeLabel: humanize(status),
      isCurrent: false,
      isActive: false
    }
  }
}

function humanize(value) {
  const text = String(value || 'Unknown').replace(/[-_]+/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

module.exports._private = { ACTIVE_LABELS, SUCCESS_STATUSES, humanize }
