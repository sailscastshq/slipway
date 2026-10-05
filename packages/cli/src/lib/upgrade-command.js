import { api } from './api.js'
import {
  commandOutput,
  reportCommandError,
  validateOutput
} from './command-output.js'
const idPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
function fail(message, code) {
  throw Object.assign(new Error(message), { code })
}
export default async function upgradeCommand(
  operation,
  options = {},
  positionals = [],
  dependencies = {}
) {
  const client = dependencies.api || api
  const delay =
    dependencies.delay ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const now = dependencies.now || Date.now
  try {
    validateOutput(options)
    const id = positionals[0]
    if (
      (operation === 'resume' ||
        (operation === 'status' && positionals.length)) &&
      (!idPattern.test(id || '') || positionals.length !== 1)
    )
      fail(
        'Specify exactly one upgrade ID from the accepted receipt.',
        'UPGRADE_ID_REQUIRED'
      )
    if (['plan', 'apply'].includes(operation) && positionals.length)
      fail('This operation accepts no positional arguments.', 'CLI_USAGE')
    if (
      ['apply', 'resume'].includes(operation) &&
      (!options.instance ||
        !/^[a-f0-9]{64}$/.test(options['approve-plan'] || ''))
    )
      fail(
        'Review upgrade:plan, then specify its exact --instance and --approve-plan.',
        'UPGRADE_APPROVAL_REQUIRED'
      )
    const timeout = Number(options.timeout || 900)
    if (
      options.wait &&
      (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 3600)
    )
      fail('--timeout must be between 1 and 3600 seconds.', 'CLI_USAGE')
    const body = {
      instanceId: options.instance,
      approval: options['approve-plan']
    }
    let result =
      operation === 'plan'
        ? await client.get('/system/upgrade/plan', { timeoutMs: 420000 })
        : operation === 'status'
        ? await client.get(id ? `/system/upgrade/${id}` : '/system/upgrade')
        : await client.post(
            operation === 'apply'
              ? '/system/upgrade/apply'
              : `/system/upgrade/${id}/resume`,
            body,
            { timeoutMs: 420000 }
          )
    if (options.wait && result.status === 'accepted') {
      const receipt = result
      if (options.ndjson)
        commandOutput(options, { type: 'upgrade.accepted', ...receipt })
      const deadline = now() + timeout * 1000
      let phase
      let completed = false
      while (now() < deadline) {
        await delay(2000)
        try {
          result = await client.get(`/system/upgrade/${receipt.id}`, {
            timeoutMs: 5000
          })
        } catch (error) {
          if ([401, 403].includes(error.statusCode)) throw error
          continue
        }
        if (options.ndjson && result.phase !== phase)
          commandOutput(options, { type: 'upgrade.status', ...result })
        phase = result.phase
        if (result.recoveryRequired)
          fail(
            `Upgrade requires recovery of checkpoint ${result.filename}. Inspect upgrade:status or the root host resume command.`,
            result.errorCode || 'upgradeRecoveryRequired'
          )
        if (
          result.phase === 'ready' &&
          result.migration?.reconciled &&
          result.migration.pending.length === 0 &&
          result.migration.manifestHash === receipt.manifestHash &&
          result.image === receipt.image
        ) {
          completed = true
          break
        }
      }
      if (!completed)
        fail(
          `Upgrade completion was not confirmed. Keep receipt ${receipt.id} and checkpoint ${receipt.filename}; inspect before retrying.`,
          'upgradeDispatchUnconfirmed'
        )
    }
    commandOutput(options, result, [JSON.stringify(result, null, 2)])
    if (result.recoveryRequired) process.exitCode = 1
  } catch (error) {
    reportCommandError(error, options)
  }
}
