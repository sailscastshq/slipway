/** Instance authority belongs to the installation founder, not team owners. */
module.exports = async function (req, res, proceed) {
  const user =
    req.auth?.userId || req.session.userId
      ? await User.forRequest(req, { select: ['isGenesisUser'] })
      : null

  if (!user?.isGenesisUser) {
    return res.forbidden()
  }

  return proceed()
}
