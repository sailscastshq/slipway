import { api } from '../lib/api.js'
import { inspectedApp } from '../lib/app-target.js'
import {
  approveTarget,
  environmentPath,
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function restart(options) {
  try {
    validateOutput(options)
    const target = approveTarget(options)
    const app = await inspectedApp(options)
    if (!app.containerName)
      throw new Error('This app has no deployed container to restart.')
    try {
      await api.post(
        `${environmentPath(options)}/apps/${encodeURIComponent(
          options.app
        )}/restart`,
        {}
      )
    } catch (error) {
      if (!error.statusCode) {
        error.message =
          'Restart outcome is unconfirmed. Inspect the app before retrying.'
        error.code = 'RESTART_UNCONFIRMED'
      }
      throw error
    }
    commandOutput(options, { restarted: true, target }, [
      `Restart confirmed: ${target.project}/${target.environment}/${target.app}`
    ])
  } catch (error) {
    reportCommandError(error, options)
  }
}
