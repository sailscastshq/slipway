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
    jobStage: { type: 'string' },
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

  fn: function ({ deployment, currentDeploymentIds, jobStage }) {
    const currentIds = new Set(
      (Array.isArray(currentDeploymentIds) ? currentDeploymentIds : [])
        .map(Number)
        .filter(Number.isFinite)
    )
    const isCurrent = currentIds.has(Number(deployment.id))
    const status = deployment.status

    if (ACTIVE_LABELS[status]) {
      return {
        status,
        outcome: 'in-progress',
        outcomeLabel: jobStage?.startsWith('ci_')
          ? ['ci_checks', 'ci_waiting', 'ci_capacity'].includes(jobStage)
            ? 'Waiting for CI'
            : 'Running CI'
          : ACTIVE_LABELS[status],
        ...(jobStage?.startsWith('ci_')
          ? {
              stage: jobStage,
              stageLabel:
                {
                  ci_checks: 'Waiting for a matching local result',
                  ci_waiting: 'Waiting for a matching local result',
                  ci_capacity: 'Waiting for CI capacity',
                  ci_running: 'Preparing isolated checks',
                  ci_install: 'Installing dependencies',
                  ci_lint: 'Running lint',
                  ci_test: 'Running tests',
                  ci_build: 'Building application assets',
                  ci_cleanup: 'Cleaning up CI'
                }[jobStage] || 'Checking source'
            }
          : {}),
        isCurrent,
        isActive: true
      }
    }

    if (SUCCESS_STATUSES.includes(status)) {
      return {
        status,
        outcome: 'succeeded',
        outcomeLabel: 'Succeeded',
        isCurrent,
        isActive: false
      }
    }

    if (status === 'failed') {
      return {
        status,
        outcome: 'failed',
        outcomeLabel: 'Failed',
        isCurrent,
        isActive: false
      }
    }

    if (status === 'cancelled') {
      return {
        status,
        outcome: 'cancelled',
        outcomeLabel: 'Cancelled',
        isCurrent,
        isActive: false
      }
    }

    return {
      status,
      outcome: 'neutral',
      outcomeLabel: humanize(status),
      isCurrent,
      isActive: false
    }
  }
}

function humanize(value) {
  const text = String(value || 'Unknown').replace(/[-_]+/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

module.exports._private = { ACTIVE_LABELS, SUCCESS_STATUSES, humanize }
