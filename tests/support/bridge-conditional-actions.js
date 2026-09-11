const models = {
  proposal: {
    identity: 'proposal',
    primaryKey: 'id',
    attributes: {
      id: { type: 'number', autoIncrement: true },
      title: { type: 'string' },
      status: { type: 'string' },
      secret: { type: 'string', protect: true }
    }
  }
}
function config() {
  return {
    resources: {
      proposal: {
        slug: 'submission',
        title: 'title',
        show: ['id', 'title', 'status'],
        authorization: 'bridge.authorize',
        actions: {
          sendDecision: {
            label: 'Send decision',
            scope: 'record',
            visibleWhen: { 'record.status': { in: ['accepted', 'rejected'] } },
            helper: 'bridge.decision',
            success: 'Decision sent.',
            fields: {
              acceptanceMessage: {
                type: 'textarea',
                label: 'Message to the speaker',
                visibleWhen: { 'record.status': 'accepted' }
              },
              reason: {
                type: 'textarea',
                label: 'Reason for rejection',
                required: true,
                visibleWhen: { 'record.status': 'rejected' }
              }
            }
          }
        }
      }
    }
  }
}
async function setup(sails, world) {
  const original = { ...sails.helpers.bridge }
  const contract = await sails.helpers.bridge.normalizeResourceContract.with({
    models,
    config: config()
  })
  const state = {
    records: {
      1: { id: 1, title: 'Building with Sails', status: 'accepted' },
      2: { id: 2, title: 'Shipping safely', status: 'rejected' }
    },
    calls: [],
    authorizations: [],
    denied: false,
    denyView: false,
    changeBeforeExecution: false,
    contract
  }
  await sails.models.app
    .updateOne({ id: world.current.apps.web.id })
    .set({ status: 'running', containerName: 'conditional-actions' })
  sails.helpers.bridge.introspectModels = async () => ({
    ...contract,
    models: contract.resources
  })
  sails.helpers.bridge.buildSailsWrapper = async (code) => code
  const helper = (fn) => ({ with: fn })
  const target = {
    models: {
      proposal: {
        findOne: (criteria) => ({
          select: async (fields) => {
            const record = state.records[criteria.id]
            return record
              ? Object.fromEntries(
                  fields
                    .filter((field) =>
                      Object.prototype.hasOwnProperty.call(record, field)
                    )
                    .map((field) => [field, record[field]])
                )
              : null
          }
        })
      }
    },
    helpers: {
      bridge: {
        authorize: helper(async (inputs) => {
          state.authorizations.push(inputs)
          return (
            !(state.denied && inputs.action === 'sendDecision') &&
            !(state.denyView && inputs.action === 'view')
          )
        }),
        decision: helper(async (inputs) => {
          state.calls.push(inputs)
          return {}
        })
      }
    }
  }
  sails.helpers.bridge.executeInContainer = async (_container, code) => {
    try {
      if (
        state.changeBeforeExecution &&
        code.includes('const helperIdentity =')
      )
        state.records[1].status = 'rejected'
      const output = await new Function(
        'sails',
        `return (async () => {${code}})();`
      )(target)
      return {
        success: true,
        output: JSON.stringify(output),
        error: null,
        exitCode: 0
      }
    } catch (error) {
      return { success: false, output: '', error: error.message, exitCode: 1 }
    }
  }
  state.restore = () => Object.assign(sails.helpers.bridge, original)
  return state
}
module.exports = { models, config, setup }
