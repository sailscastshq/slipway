import { api } from '../lib/api.js'
import { getCredentials, getProjectConfig, isLoggedIn } from '../lib/config.js'
import {
  selectedTarget,
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function doctor(options) {
  try {
    validateOutput(options)
    if (options.app && !(options.project || getProjectConfig()?.project))
      throw new Error(
        'Specify --project or link this directory before checking an app target.'
      )
    const checks = []
    let server
    let credentials
    try {
      credentials = getCredentials()
      if (!credentials.server)
        throw new Error(
          'No Slipway server is configured. Run `slipway login` first.'
        )
      server = new URL(credentials.server)
      const health = await fetch(`${credentials.server}/health`, {
        signal: AbortSignal.timeout(30000)
      })
      if (!health.ok)
        throw new Error(`Server health request failed (${health.status}).`)
      const data = await health.json()
      if (data.status !== 'ok')
        throw new Error('Server health was not confirmed.')
      checks.push({ name: 'server', ok: true, version: data.version })
    } catch (error) {
      checks.push({ name: 'server', ok: false, message: error.message })
    }
    let authenticated = false
    try {
      if (!isLoggedIn())
        throw new Error('No saved CLI credential. Run `slipway login` first.')
      const projects = await api.projects.list()
      if (!Array.isArray(projects.projects))
        throw new Error('Unexpected authenticated project response.')
      authenticated = true
      checks.push({
        name: 'authentication',
        ok: true,
        method: 'saved-cli-token'
      })
    } catch (error) {
      checks.push({
        name: 'authentication',
        ok: false,
        code: error.body?.code || 'AUTH_CHECK_FAILED',
        message: error.message
      })
    }
    if (options.project || getProjectConfig()?.project) {
      const target = selectedTarget(options)
      if (authenticated) {
        try {
          const readiness = await api.environments.readiness(
            target.project,
            target.environment,
            target.app
          )
          const ready = readiness.canDeploy === true
          checks.push({
            name: 'target-readiness',
            ok: ready,
            target,
            report: {
              canDeploy: readiness.canDeploy,
              version: readiness.version,
              summary: readiness.summary,
              healthPath: readiness.healthPath,
              items: Array.isArray(readiness.items)
                ? readiness.items.map((item) => ({
                    status: item.status,
                    category: item.category,
                    title: item.title,
                    fix: item.fix
                  }))
                : []
            }
          })
        } catch (error) {
          checks.push({
            name: 'target-readiness',
            ok: false,
            target,
            message: error.message
          })
        }
      } else
        checks.push({
          name: 'target-readiness',
          ok: false,
          target,
          message: 'Authenticate before checking the target.'
        })
    }
    const ok = checks.every((check) => check.ok)
    if (!ok) process.exitCode = 1
    commandOutput(
      options,
      { ok, ...(server ? { server: server.origin } : {}), checks },
      checks.map(
        (check) =>
          `${check.ok ? 'PASS' : 'FAIL'} ${check.name}${
            check.message ? `: ${check.message}` : ''
          }`
      )
    )
  } catch (error) {
    reportCommandError(error, options)
  }
}
