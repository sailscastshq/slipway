const { getPublicMatrix } = require('../../../../lib/service-image-policy')

module.exports = {
  friendlyName: 'List service versions',

  description:
    'Return the tested service-version matrix and pinned defaults used by Slipway.',

  exits: {
    success: {
      statusCode: 200
    }
  },

  fn: async function () {
    return { services: getPublicMatrix() }
  }
}
