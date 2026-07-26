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
                  if (!userId) {
                    return null
                  }
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
                  const ownedTeams = await Team.find({ owner: user.id }).select(
                    ['id', 'name', 'slug', 'logoUrl']
                  )

                  return { ...user, ownedTeams }
                })
              )

              sails.inertia.share('navProjects', async () => {
                const user = await User.findOne({ id: userId }).select(['team'])
                if (!user || !user.team) {
                  return []
                }
                return await Project.find({ team: user.team })
                  .select(['name', 'slug'])
                  .sort('name ASC')
              })

              sails.inertia.share('navApps', async () => {
                try {
                  const user = await User.findOne({ id: userId }).select([
                    'team'
                  ])
                  if (!user || !user.team) {
                    return []
                  }
                  const projects = await Project.find({
                    team: user.team
                  }).select(['id', 'name', 'slug'])
                  const projectIds = projects.map((p) => p.id)
                  const environments = await Environment.find({
                    project: projectIds
                  }).select(['id', 'slug', 'name', 'project', 'domain'])
                  const envIds = environments.map((e) => e.id)
                  const apps = await App.find({ environment: envIds }).select([
                    'name',
                    'slug',
                    'environment'
                  ])
                  const wildcardDomain = await sails.helpers.setting.get(
                    'wildcardDomain'
                  )
                  const slipwayDomain = sails.config.custom.slipwayDomain
                  const accessByEnvironment = new Map(
                    await Promise.all(
                      environments.map(async (environment) => {
                        const project = projects.find(
                          (candidate) => candidate.id === environment.project
                        )
                        const access = project
                          ? await Environment.resolveAppUrls(
                              { ...environment, project },
                              { wildcardDomain, slipwayDomain }
                            )
                          : { primaryUrl: null }
                        return [environment.id, access]
                      })
                    )
                  )
                  return apps.map((app) => {
                    const env = environments.find(
                      (e) => e.id === app.environment
                    )
                    const project = projects.find((p) => p.id === env?.project)
                    const url =
                      accessByEnvironment.get(app.environment)?.primaryUrl ||
                      null
                    return {
                      name: app.name,
                      slug: app.slug,
                      projectName: project?.name,
                      projectSlug: project?.slug,
                      envName: env?.name,
                      envSlug: env?.slug,
                      url
                    }
                  })
                } catch (err) {
                  sails.log.error('navApps shared prop error:', err)
                  return []
                }
              })

              sails.inertia.share('navServices', async () => {
                try {
                  const user = await User.findOne({ id: userId }).select([
                    'team'
                  ])
                  if (!user || !user.team) {
                    return []
                  }
                  const projects = await Project.find({
                    team: user.team
                  }).select(['id', 'name', 'slug'])
                  const projectIds = projects.map((p) => p.id)
                  const environments = await Environment.find({
                    project: projectIds
                  }).select(['id', 'slug', 'name', 'project'])
                  const envIds = environments.map((e) => e.id)
                  const services = await Service.find({
                    environment: envIds
                  }).select(['id', 'name', 'type', 'environment'])
                  return services.map((service) => {
                    const env = environments.find(
                      (e) => e.id === service.environment
                    )
                    const project = projects.find((p) => p.id === env?.project)
                    return {
                      id: service.id,
                      name: service.name,
                      type: service.type,
                      projectName: project?.name,
                      projectSlug: project?.slug,
                      envName: env?.name,
                      envSlug: env?.slug
                    }
                  })
                } catch (err) {
                  sails.log.error('navServices shared prop error:', err)
                  return []
                }
              })

              res.setHeader('Cache-Control', 'no-cache, no-store')
              return next()
            } else {
              sails.inertia.flushShared('loggedInUser')
              sails.inertia.flushShared('navProjects')
              sails.inertia.flushShared('navApps')
              sails.inertia.flushShared('navServices')
            }
            return next()
          }
        }
      }
    }
  }
}
