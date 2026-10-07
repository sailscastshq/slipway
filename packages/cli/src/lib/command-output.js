import { safeDiagnostic } from './diagnostic-output.js'
import { getProjectConfig } from './config.js'

export function targetProject(options) {
  const project = options.project || getProjectConfig()?.project
  if (!project)
    throw new Error(
      'Specify --project <slug> or link this directory with `slipway link`.'
    )
  return encodeURIComponent(project)
}
export function environmentPath(options) {
  return `/projects/${targetProject(options)}/environments/${encodeURIComponent(
    options.env || 'production'
  )}`
}
export function validateOutput(options) {
  if (options.json && options.ndjson)
    throw new Error('Choose either --json or --ndjson.')
}
export function reportCommandError(error, options) {
  if (options.json || options.ndjson)
    console.error(
      JSON.stringify({
        type: 'error',
        error: {
          code: error.body?.code || error.code || 'CLI_ERROR',
          message: safeDiagnostic(error.message),
          ...(error.statusCode ? { status: error.statusCode } : {})
        }
      })
    )
  else console.error(`Error: ${safeDiagnostic(error.message)}`)
  process.exitCode = 1
}

export function commandOutput(options, result, lines = []) {
  if (options.json || options.ndjson)
    console.log(JSON.stringify(safeDiagnostic(result)))
  else for (const line of lines) console.log(safeDiagnostic(line))
}

export function selectedTarget(options, { requireApp = false } = {}) {
  if (requireApp && !options.app)
    throw new Error('Specify --app <slug> for this operation.')
  return {
    project: decodeURIComponent(targetProject(options)),
    environment: options.env || 'production',
    ...(options.app ? { app: options.app } : {})
  }
}

export function approveTarget(options) {
  const target = selectedTarget(options, { requireApp: true })
  const confirmation = `${target.project}/${target.environment}/${target.app}`
  if (options['approve-target'] !== confirmation) {
    const error = new Error(
      `Review the exact target, then pass --approve-target ${confirmation}.`
    )
    error.code = 'TARGET_APPROVAL_REQUIRED'
    throw error
  }
  return target
}

export function publicExecutionTarget(target = {}) {
  const fields = {
    project: ['id', 'name', 'slug'],
    environment: ['id', 'name', 'slug', 'isProduction'],
    app: ['id', 'name', 'slug'],
    deployment: ['id', 'gitCommit', 'gitBranch', 'imageId', 'imageName']
  }
  const safe = Object.fromEntries(
    ['container', 'version', 'displayVersion']
      .filter((key) => target[key] !== undefined)
      .map((key) => [key, target[key]])
  )
  for (const [section, keys] of Object.entries(fields))
    if (target[section])
      safe[section] = Object.fromEntries(
        keys
          .filter((key) => target[section][key] !== undefined)
          .map((key) => [key, target[section][key]])
      )
  return safe
}
