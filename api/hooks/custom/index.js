/**
 * custom hook
 *
 * @description :: A hook definition.  Extends Sails by adding shadow routes, implicit actions, and/or initialization logic.
 * @docs        :: https://sailsjs.com/docs/concepts/extending-sails/hooks
 */

module.exports = function defineCustomHook(sails) {
  return {
    /**
     * Runs when this Sails app loads/lifts.
     */
    initialize: async function () {
      sails.log.info('Initializing custom hook (`custom`)')
    },
    routes: {
      before: {
        'GET /*': {
          skipAssets: true,
          fn: async function (req, res, next) {
            if (req.session.userId) {
              // Use once() to cache the logged-in user data on the client.
              // This avoids fetching the same user data on every navigation.
              // The data is cached until:
              // - The user logs out (session cleared)
              // - The user explicitly refreshes
              // - The prop is marked as .fresh() after profile updates
              const userId = req.session.userId
              sails.inertia.share(
                'loggedInUser',
                sails.inertia.once(async () => {
                  if (!userId) { return null }
                  const user = await User.findOne({
                    id: userId
                  })
                    .select(['email', 'fullName', 'initials', 'team'])
                    .populate('team')

                  if (!user) {
                    sails.log.warn(
                      'Somehow, the user record for the logged-in user (`' +
                        req.session.userId +
                        '`) has gone missing....'
                    )
                    delete req.session.userId
                    return null
                  }

                  // Also fetch teams owned by this user (for team switching)
                  const ownedTeams = await Team.find({ owner: user.id }).select(['id', 'name', 'slug', 'logoUrl'])

                  return { ...user, ownedTeams }
                })
              )

              sails.inertia.share('navProjects', async () => {
                const user = await User.findOne({ id: userId }).select(['team'])
                if (!user || !user.team) { return [] }
                return await Project.find({ team: user.team })
                  .select(['name', 'slug'])
                  .sort('name ASC')
              })

              res.setHeader('Cache-Control', 'no-cache, no-store')
              return next()
            } else {
              sails.inertia.flushShared('loggedInUser')
              sails.inertia.flushShared('navProjects')
            }
            return next()
          }
        }
      }
    }
  }
}
