import { api } from '../lib/api.js'
import {
  environmentPath,
  selectedTarget,
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function history(options) {
  try {
    validateOutput(options)
    const target = selectedTarget(options, { requireApp: true })
    const query = new URLSearchParams({ mode: 'command', appSlug: options.app })
    const result = await api.get(
      `${environmentPath(options)}/helm/history?${query}`
    )
    if (!Array.isArray(result.entries))
      throw new Error('Unexpected command history from Slipway.')
    const entries = result.entries.map((entry) =>
      Object.fromEntries(
        ['id', 'status', 'durationMs', 'executedAt', 'targetLabel', 'pinned']
          .filter((key) => entry[key] !== undefined)
          .map((key) => [key, entry[key]])
      )
    )
    commandOutput(
      options,
      {
        target,
        entries,
        retentionDays: result.retentionDays,
        executionLookup: false
      },
      entries.length
        ? entries.map(
            (entry) =>
              `${entry.id}\t${entry.status}\t${entry.durationMs}ms\t${
                entry.targetLabel || ''
              }`
          )
        : ['No retained command history for this app.']
    )
  } catch (error) {
    reportCommandError(error, options)
  }
}
