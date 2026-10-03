import { inspectedApp } from '../lib/app-target.js'
import {
  selectedTarget,
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function inspect(options) {
  try {
    validateOutput(options)
    const target = selectedTarget(options, { requireApp: true })
    const app = await inspectedApp(options)
    commandOutput(options, { target, app }, [
      `${target.project}/${target.environment}/${target.app}`,
      `Status: ${app.status}`,
      `Deployment: ${app.currentDeployment || 'none'}`
    ])
  } catch (error) {
    reportCommandError(error, options)
  }
}
