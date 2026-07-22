module.exports = {
  friendlyName: 'Reconcile container statuses',

  description:
    'Converge stable app and service statuses with an authoritative Docker lifecycle snapshot.',

  inputs: {
    containerStates: {
      type: 'ref',
      description:
        'Optional complete lifecycle snapshot. When omitted, Docker is queried directly.'
    }
  },

  exits: {
    success: {
      description: 'Status transitions that were persisted.',
      outputType: 'ref'
    }
  },

  fn: async function ({ containerStates }) {
    if (containerStates === undefined) {
      containerStates = await sails.helpers.docker.listContainerStates()
    }

    if (!Array.isArray(containerStates)) {
      throw new Error('containerStates must be a complete array snapshot.')
    }

    const statesByName = new Map(
      containerStates.map((state) => [state.name, state])
    )
    const [apps, services] = await Promise.all([
      sails.models.app.find().select(['id', 'status', 'containerName']),
      sails.models.service.find().select(['id', 'status', 'containerName'])
    ])

    const appTransitions = await reconcileRecords({
      model: sails.models.app,
      records: apps,
      resourceType: 'app',
      statesByName
    })
    const serviceTransitions = await reconcileRecords({
      model: sails.models.service,
      records: services,
      resourceType: 'service',
      statesByName
    })

    return [...appTransitions, ...serviceTransitions]
  }
}

async function reconcileRecords({
  model,
  records,
  resourceType,
  statesByName
}) {
  const transitions = []

  for (const record of records) {
    if (!record.containerName) continue
    if (!['running', 'stopped'].includes(record.status)) continue

    const nextStatus = getStableStatus(statesByName.get(record.containerName))
    if (!nextStatus || nextStatus === record.status) continue

    const updated = await model
      .updateOne({
        id: record.id,
        status: record.status,
        containerName: record.containerName
      })
      .set({ status: nextStatus })

    if (!updated) continue

    transitions.push({
      resourceType,
      id: record.id,
      containerName: record.containerName,
      from: record.status,
      to: nextStatus
    })
  }

  return transitions
}

function getStableStatus(containerState) {
  if (!containerState) return 'stopped'

  const state = String(containerState.state || '').toLowerCase()
  if (containerState.running === true || state === 'running') return 'running'
  if (['exited', 'dead', 'stopped'].includes(state)) return 'stopped'

  // Restarting, paused, created, and removing are transitional Docker states.
  // Preserve Slipway's last stable status until Docker converges.
  return null
}

module.exports._private = { getStableStatus, reconcileRecords }
