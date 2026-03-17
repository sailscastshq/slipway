/**
 * Revoke Deploy Token
 */
module.exports = {
  friendlyName: 'Revoke Deploy Token',

  description: 'Revoke a deploy token.',

  inputs: {
    id: {
      type: 'string',
      required: true
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    notFound: {
      statusCode: 404
    },
    forbidden: {
      statusCode: 403
    }
  },

  fn: async function ({ id }) {
    const user = await User.findOne({ id: this.req.session.userId })

    const token = await DeployToken.findOne({ id })

    if (!token) {
      throw 'notFound'
    }

    if (token.team !== user.team) {
      throw 'forbidden'
    }

    await DeployToken.updateOne({ id }).set({
      isActive: false,
      revokedAt: Date.now(),
      revokedBy: user.id
    })

    sails.log.info(
      `[token] Deploy token "${token.name}" revoked by ${user.email}`
    )

    return { message: 'Token revoked successfully' }
  }
}
