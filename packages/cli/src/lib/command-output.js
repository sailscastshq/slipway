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
          message: error.message,
          ...(error.statusCode ? { status: error.statusCode } : {})
        }
      })
    )
  else console.error(`Error: ${error.message}`)
  process.exitCode = 1
}
