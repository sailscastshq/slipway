const { randomBytes } = require('node:crypto')
const decoys = require('../../../../helpers/lookout/decoy-config')._private
const saving = new Set()

module.exports = {
  friendlyName: 'Update Lookout Decoys',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true },
    enabled: { type: 'ref', required: true },
    paths: { type: 'ref', required: true },
    acknowledged: { type: 'ref' }
  },
  exits: {
    success: { responseType: 'mutationSuccess' },
    notFound: { statusCode: 404 },
    forbidden: { statusCode: 403 },
    badRequest: { responseType: 'mutationBadRequest' },
    precognitionSuccess: { responseType: 'precognitionSuccess' }
  },
  fn: async function ({
    projectSlug,
    environmentSlug,
    appSlug,
    enabled,
    paths,
    acknowledged
  }) {
    const user = await User.forRequest(this.req)
    const project = await Project.findOne({
      slug: projectSlug,
      team: user.team
    })
    if (!project) throw 'notFound'
    if (!['owner', 'admin'].includes(user.teamRole)) throw 'forbidden'
    const environment = await Environment.findOne({
      project: project.id,
      slug: environmentSlug
    })
    if (!environment) throw 'notFound'
    const apps = await sails.helpers.lookout.decoyConfig(
      await App.find({ environment: environment.id })
    )
    const app = apps.find((a) => a.slug === appSlug)
    if (!app) throw 'notFound'
    const fail = (message) => {
      throw { badRequest: { problems: [{ decoys: message }] } }
    }
    if (
      typeof enabled !== 'boolean' ||
      !Array.isArray(paths) ||
      paths.length > decoys.PATHS.length ||
      paths.some((p) => typeof p !== 'string' || !decoys.PATHS.includes(p)) ||
      new Set(paths).size !== paths.length
    )
      fail('Choose distinct paths from the decoy allowlist.')
    if (enabled && (acknowledged !== true || !paths.length))
      fail('Select a path and confirm that the selected paths are unused.')
    const next = enabled
      ? { enabled, paths, revision: randomBytes(16).toString('hex') }
      : { ...decoys.OFF }
    const candidate = { ...app, lookoutDecoys: next }
    const conflict = decoys.validate(candidate, apps)
    if (conflict) fail(conflict)
    if (sails.inertia.isPrecognitive(this.req)) throw 'precognitionSuccess'
    if (saving.has(String(environment.id)))
      fail('Another decoy update is in progress. Try again shortly.')
    saving.add(String(environment.id))
    let staged
    let persisted = false
    try {
      if (app.hostPort && app.routePath !== null) {
        staged = await sails.helpers.caddy.updateRoute.with({
          environmentId: environment.id,
          apps: apps.map((a) => (a.id === app.id ? candidate : a)),
          routeVersion: `decoys-${randomBytes(8).toString('hex')}`,
          deferCommit: true
        })
      }
      if (enabled && staged && !staged.domains?.length)
        throw new Error(
          'The deployed app needs an ingress domain before decoys can be applied.'
        )
      await sails.helpers.setting.set(decoys.key(app.id), JSON.stringify(next))
      persisted = true
      if (staged?.transaction)
        await sails.helpers.caddy.finishRouteUpdate.with({
          action: 'commit',
          transaction: staged.transaction
        })
      return { decoys: next }
    } catch (error) {
      // Attempt both recovery steps even if one fails. Never claim a rollback
      // was confirmed when either persisted settings or ingress is uncertain.
      let recoveryFailed = false
      if (persisted) {
        try {
          await sails.helpers.setting.set(
            decoys.key(app.id),
            JSON.stringify(app.lookoutDecoys)
          )
        } catch {
          recoveryFailed = true
        }
      }
      if (staged?.transaction) {
        try {
          await sails.helpers.caddy.finishRouteUpdate.with({
            action: 'rollback',
            transaction: staged.transaction
          })
        } catch {
          recoveryFailed = true
        }
      }
      if (recoveryFailed)
        fail(
          'The update could not be confirmed and recovery is incomplete. Check proxy routing and saved decoy settings before retrying.'
        )
      sails.log.warn('Lookout Decoys: configuration update failed')
      fail(
        'Decoy settings could not be applied. Previous settings were retained; check proxy compatibility before retrying.'
      )
    } finally {
      saving.delete(String(environment.id))
    }
  }
}
