module.exports = {
  friendlyName: 'Change restore test',
  inputs: {
    testId: { type: 'number', required: true },
    action: { type: 'string', isIn: ['cancel', 'cleanup'], required: true }
  },
  exits: {
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { statusCode: 400 }
  },
  fn: async function ({ testId, action }) {
    const user = await User.forRequest(this.req)
    const test = await RestoreTest.findOne({ id: testId })
    if (!test) throw 'notFound'
    if (test.team !== user.team) throw 'forbidden'
    try {
      await sails.helpers.backup.manageRestoreTests.with({
        action,
        testId,
        teamId: user.team
      })
      return { success: true }
    } catch (error) {
      throw { badRequest: { message: error.message } }
    }
  }
}
