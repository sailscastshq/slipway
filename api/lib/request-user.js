module.exports = async function requestUser(
  req,
  { populateTeam = false, select } = {}
) {
  const user = await User.findOne({
    id: req.auth?.userId || req.session?.userId
  })
  if (!user) return null
  const teamId = req.auth?.teamId ?? req.session?.activeTeamId ?? user.team
  const membership = teamId
    ? await TeamMembership.findOne({
        user: user.id,
        team: teamId,
        status: 'active'
      })
    : null
  const team = membership ? await Team.findOne({ id: membership.team }) : null
  const result = Object.assign(user, {
    team: populateTeam ? team || null : team?.id || null,
    teamRole: membership
      ? team?.owner === user.id
        ? 'owner'
        : membership.role
      : null
  })
  if (select)
    return Object.fromEntries(
      ['id', ...select].map((key) => [key, result[key]])
    )
  return result
}
