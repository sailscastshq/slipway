module.exports = {
  friendlyName: 'resume Quest job',
  description:
    'Legacy controls are disabled because temporary Sails instances do not own resident schedules.',
  inputs: {
    containerName: { type: 'string', required: true },
    jobName: { type: 'string', required: true }
  },
  fn: async function () {
    throw new Error('Use the verified resident Quest runtime to resume a job.')
  }
}
