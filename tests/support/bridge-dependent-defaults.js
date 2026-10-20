const { setup: base } = require('./bridge-conditional-actions')
const models = {
  session: {
    identity: 'session',
    primaryKey: 'id',
    attributes: {
      id: { type: 'number', autoIncrement: true },
      title: { type: 'string' },
      event: { type: 'string', isIn: ['event-1', 'event-2'] },
      proposal: { type: 'string', isIn: ['proposal-1', 'proposal-2'] },
      speaker: { type: 'string' },
      track: { type: 'string' },
      secret: { type: 'string', protect: true }
    }
  }
}
const provider = {
  helper: 'bridge.programmeEntryDefaults',
  dependsOn: ['event', 'proposal'],
  fields: ['title', 'speaker', 'track']
}
const config = {
  resources: {
    session: {
      authorization: 'bridge.authorizeSession',
      defaultsProvider: provider,
      fields: {
        event: {
          type: 'select',
          options: [
            { value: 'event-1', label: 'SailsConf' },
            { value: 'event-2', label: 'Other event' }
          ]
        },
        proposal: {
          type: 'select',
          options: [
            { value: 'proposal-1', label: 'Building with Sails' },
            { value: 'proposal-2', label: 'Shipping safely' }
          ]
        }
      }
    }
  }
}
async function setup(sails, world) {
  const state = await base(sails, world)
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models,
    config
  })
  state.contract.resources.session = contract.resources.session
  state.defaultsCalls = []
  state.target.models.session = {
    findOne: () => ({
      select: async () => ({
        id: 1,
        title: 'Existing session',
        event: 'event-1',
        proposal: 'proposal-1'
      })
    })
  }
  state.target.helpers.bridge.authorizeSession = {
    with: async () => !state.denyDefaults
  }
  state.target.helpers.bridge.programmeEntryDefaults = {
    with: async (input) => {
      state.defaultsCalls.push(input)
      if (input.values.event !== 'event-1')
        throw new Error('Out of event scope')
      if (state.response) return state.response
      return {
        values: {
          title:
            input.values.proposal === 'proposal-1'
              ? 'Building with Sails'
              : 'Shipping safely',
          speaker: 'Ada Example',
          track: 'Main stage'
        }
      }
    }
  }
  return state
}
module.exports = { setup, models, config, provider }
