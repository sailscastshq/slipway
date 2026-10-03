import { api } from '../lib/api.js'
import {
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function cancel(options, positionals) {
  try {
    validateOutput(options)
    const executionId = positionals[0]
    if (
      positionals.length !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        executionId || ''
      )
    )
      throw new Error('Provide exactly one valid execution UUID.')
    const { cancelled } = await api.post(
      `/helm/executions/${executionId}/cancel`,
      {}
    )
    const message =
      cancelled === true
        ? 'Cancellation confirmed for the owned execution.'
        : 'Cancellation was not confirmed. The execution may be unknown, completed, not owned, or unconfirmed. Check the app before retrying.'
    if (cancelled !== true) process.exitCode = 1
    commandOutput(
      options,
      { executionId, cancelled: cancelled === true, message },
      [message]
    )
  } catch (error) {
    reportCommandError(error, options)
  }
}
