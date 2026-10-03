import { api } from './api.js'
import { environmentPath, selectedTarget } from './command-output.js'

export function publicApp(app) {
  const safe = Object.fromEntries(
    [
      'id',
      'name',
      'slug',
      'status',
      'isDefault',
      'containerName',
      'imageName',
      'healthPath',
      'dockerfilePath'
    ]
      .filter((key) => app[key] !== undefined)
      .map((key) => [key, app[key]])
  )
  if (app.currentDeployment !== undefined)
    safe.currentDeployment =
      typeof app.currentDeployment === 'object'
        ? app.currentDeployment?.id
        : app.currentDeployment
  if (app.resourceLimits)
    safe.resourceLimits = Object.fromEntries(
      ['cpus', 'memory']
        .filter((key) => app.resourceLimits[key] !== undefined)
        .map((key) => [key, app.resourceLimits[key]])
    )
  return safe
}
export async function listApps(options) {
  const { apps } = await api.get(`${environmentPath(options)}/apps`)
  if (!Array.isArray(apps))
    throw new Error('Unexpected application list from Slipway.')
  return apps.map(publicApp)
}
export async function inspectedApp(options) {
  selectedTarget(options, { requireApp: true })
  const apps = await listApps(options)
  const app = apps.find((app) => app.slug === options.app)
  if (!app) {
    const error = new Error(
      `App "${options.app}" was not found in the selected environment.`
    )
    error.code = 'APP_NOT_FOUND'
    throw error
  }
  return app
}
