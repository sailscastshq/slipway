const { test } = require('sounding')

test(
  'Bridge pre-execution check tolerates Waterline adding the primary key to selected fields',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'condition-state' } }
    }
  },
  async ({ sails, world, expect }) => {
    const original = { ...sails.helpers.bridge }
    const user = world.current.users.genesisUser
    let calls = 0
    try {
      sails.helpers.bridge.buildSailsWrapper = async (code) => code
      sails.helpers.bridge.executeInContainer = async (_container, code) => {
        const decision = {
          with: async () => {
            calls++
            return {}
          }
        }
        const output = await new Function(
          'sails',
          `return (async () => {${code}})();`
        )({
          models: { user: sails.models.user },
          helpers: { bridge: { decision } }
        })
        return { success: true, output: JSON.stringify(output) }
      }
      await sails.helpers.bridge.executeCustomAction.with({
        containerName: 'test',
        resource: { identity: 'user', primaryKey: 'id' },
        action: {
          name: 'sendDecision',
          label: 'Send decision',
          helper: 'bridge.decision',
          fields: {},
          success: 'Sent'
        },
        actor: { id: String(user.id) },
        values: {},
        recordId: user.id,
        conditionState: { fields: ['fullName'], values: [user.fullName] }
      })
      expect(calls).toBe(1)
    } finally {
      Object.assign(sails.helpers.bridge, original)
    }
  }
)
