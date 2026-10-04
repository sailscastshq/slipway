import { listApps, inspectedApp } from '../lib/app-target.js'
import {
  selectedTarget,
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function apps(options) {
  try {
    validateOutput(options)
    const target = selectedTarget(options)
    const apps = options.app
      ? [await inspectedApp(options)]
      : await listApps(options)
    commandOutput(
      options,
      { target, apps },
      apps.length
        ? apps.map((app) => `${app.slug}\t${app.status}\t${app.name}`)
        : ['No apps in this environment.']
    )
  } catch (error) {
    reportCommandError(error, options)
  }
}
