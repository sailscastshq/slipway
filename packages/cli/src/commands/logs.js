import { safeDiagnostic } from '../lib/diagnostic-output.js'
import { api } from '../lib/api.js'
import { streamRequest } from '../lib/stream.js'
import {
  environmentPath,
  validateOutput,
  reportCommandError
} from '../lib/command-output.js'

export default async function logs(options) {
  try {
    validateOutput(options)
    if (options.json && options.follow)
      throw new Error(
        'Use --ndjson for live --follow logs; --json is a bounded snapshot.'
      )
    if (options.deployment) {
      if (options.follow)
        throw new Error('--follow is available for application logs only.')
      const result = await api.deployments.logs(
        encodeURIComponent(options.deployment),
        'all'
      )
      if (options.json) console.log(JSON.stringify(safeDiagnostic(result)))
      else if (options.ndjson)
        console.log(
          JSON.stringify(safeDiagnostic({ type: 'deployment-logs', ...result }))
        )
      else
        process.stdout.write(
          `${[
            safeDiagnostic(result.buildLogs),
            safeDiagnostic(result.deployLogs)
          ]
            .filter(Boolean)
            .join('\n')}\n`
        )
      return
    }
    const tail = Number(options.tail)
    if (
      !/^\d+$/.test(String(options.tail)) ||
      !Number.isSafeInteger(tail) ||
      tail > 10000
    )
      throw new Error('--tail must be an integer between 0 and 10000.')
    const path = `${environmentPath(options)}${
      options.app ? `/apps/${encodeURIComponent(options.app)}` : ''
    }/logs/stream?tail=${tail}&follow=${Boolean(options.follow)}`
    const lines = []
    let outputBytes = 0
    let closed = false
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    process.once('SIGINT', interrupt)
    try {
      await streamRequest(path, {
        format: 'sse',
        signal: options.follow
          ? controller.signal
          : AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]),
        onEvent({ data }) {
          if (data.error) throw new Error(data.error)
          if (data.closed) closed = true
          if (options.ndjson) console.log(JSON.stringify(data))
          else if (data.log !== undefined) {
            if (options.json) {
              outputBytes += Buffer.byteLength(data.log)
              if (outputBytes > 16 * 1024 * 1024)
                throw new Error(
                  'JSON log snapshot exceeds 16 MiB. Use --ndjson or a smaller --tail.'
                )
              lines.push(data.log)
            } else console.log(data.log)
          }
        }
      })
    } catch (error) {
      if (controller.signal.aborted) {
        process.exitCode = 130
        return
      }
      throw error
    } finally {
      process.removeListener('SIGINT', interrupt)
    }
    if (!closed)
      throw new Error(
        'Log stream ended unexpectedly. Reconnect to check current logs.'
      )
    if (options.json) console.log(JSON.stringify({ logs: lines }))
  } catch (error) {
    reportCommandError(error, options)
  }
}
