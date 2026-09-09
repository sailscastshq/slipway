/** Require the current active-team capability before accepting execution inputs. */
module.exports = async function (req, res, proceed) {
  const user = await User.forRequest(req)
  if (!user || !['owner', 'admin'].includes(user.teamRole)) {
    return res.status(403).json({
      message:
        'Running database commands requires a team owner or administrator.'
    })
  }
  return proceed()
}
