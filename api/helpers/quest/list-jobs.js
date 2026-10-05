module.exports = {
  friendlyName: 'List Quest jobs',
  description:
    'Legacy source detection only. Resident state comes from the verified runtime bridge.',
  inputs: {
    containerName: { type: 'string', required: true },
    questFeature: { type: 'ref', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ questFeature }) {
    return {
      jobs: (questFeature.scripts || []).map((script) => ({
        name: script.name,
        friendlyName: script.name,
        description: '',
        schedule: null,
        scheduleType: 'unavailable',
        paused: null,
        isRunning: null
      })),
      error: 'Resident Quest state is unavailable on legacy hooks.'
    }
  }
}
