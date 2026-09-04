/** Instance authority belongs to the installation founder, not team owners. */
module.exports = async function (req, res, proceed) {
  const user = req.session.userId
    ? await User.findOne({ id: req.session.userId }).select(['isGenesisUser'])
    : null

  if (!user?.isGenesisUser) {
    return res.forbidden()
  }

  return proceed()
}
