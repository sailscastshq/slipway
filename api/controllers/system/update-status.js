module.exports = {
  friendlyName: 'Update status',
  inputs: {},
  exits: { success: {}, unavailable: { statusCode: 503 } },
  fn: async function () {
    try {
      return await sails.helpers.system.getUpdateStatus()
    } catch {
      throw {
        unavailable: {
          message:
            'Update status is temporarily unavailable. No failure or rollback has been confirmed.'
        }
      }
    }
  }
}
