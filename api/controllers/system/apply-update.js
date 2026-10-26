module.exports = {
  friendlyName: 'Apply update',
  description:
    'Admit or join a detached update operation and return its durable identity.',
  inputs: {},
  exits: {
    success: { statusCode: 202 },
    badRequest: { responseType: 'badRequest' }
  },
  fn: async function () {
    try {
      return await sails.helpers.system.applyUpdate()
    } catch (error) {
      throw {
        badRequest: {
          message:
            error === 'noUpdate' || error.code === 'noUpdate'
              ? 'Already running the latest version.'
              : error.message ||
                'Update could not be admitted. Check the current operation before retrying.'
        }
      }
    }
  }
}
