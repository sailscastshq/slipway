import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { commandInput } from '../lib/command-input.js'
import { privateFile } from '../lib/private-file.js'
import { APIError } from '../lib/api.js'
import { streamRequest } from '../lib/stream.js'
import {
  environmentPath,
  validateOutput,
  reportCommandError,
  publicExecutionTarget
} from '../lib/command-output.js'

export default async function run(options, positionals) {
  let receipt
  let receiptState
  try {
    validateOutput(options)
    const code = await commandInput(options, positionals)
    const commandPath = `${environmentPath(options)}/helm/commands`
    const writeArmToken = options['write-arm-file']
      ? (await readFile(options['write-arm-file'], 'utf8')).trim()
      : undefined
    const executionId = randomUUID()
    if (options['receipt-file']) {
      receipt = await privateFile(options['receipt-file'])
      receiptState = {
        version: 1,
        executionId,
        status: 'prepared',
        createdAt: new Date().toISOString()
      }
      await receipt.write(receiptState)
    }
    let result
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    process.once('SIGINT', interrupt)
    try {
      await streamRequest(commandPath, {
        method: 'POST',
        format: 'ndjson',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10 * 60 * 1000)
        ]),
        body: {
          code,
          executionId,
          ...(options.app ? { appSlug: options.app } : {}),
          ...(writeArmToken ? { writeArmToken } : {})
        },
        async onEvent(event) {
          if (event.type === 'accepted' && receipt) {
            receiptState.status = 'accepted'
            receiptState.target = publicExecutionTarget(event.target)
            await receipt.write(receiptState)
          }
          if (event.type === 'result') {
            result = event.result
            if (receipt) {
              receiptState.status = 'finished'
              receiptState.result = Object.fromEntries(
                [
                  'success',
                  'status',
                  'exitCode',
                  'signal',
                  'durationMs',
                  'terminationConfirmed',
                  'terminationScope',
                  'exitStatusObserved',
                  'truncated'
                ]
                  .filter((key) => result[key] !== undefined)
                  .map((key) => [key, result[key]])
              )
              await receipt.write(receiptState)
            }
          }
          if (options.ndjson) console.log(JSON.stringify(event))
          else if (!options.json && ['stdout', 'stderr'].includes(event.type))
            process[event.type].write(event.text)
        }
      })
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error(
          'Command interrupted; termination is unconfirmed. Check the app before running it again.'
        )
      if (!(error instanceof APIError)) {
        const uncertain = new Error(
          'Command outcome is unconfirmed. Check the app before running it again.'
        )
        uncertain.code = 'COMMAND_UNCONFIRMED'
        throw uncertain
      }
      throw error
    } finally {
      process.removeListener('SIGINT', interrupt)
    }
    if (!result)
      throw new Error(
        'Command stream ended without an outcome. Check the app before running it again.'
      )
    if (options.json) console.log(JSON.stringify({ executionId, result }))
    if (!result.success) {
      process.exitCode =
        Number.isInteger(result.exitCode) &&
        result.exitCode > 0 &&
        result.exitCode <= 255
          ? result.exitCode
          : 1
      if (!options.json && !options.ndjson)
        console.error(
          result.error?.message || `Command ${result.status || 'failed'}.`
        )
    }
  } catch (error) {
    if (receipt) {
      receiptState.status = error.statusCode ? 'rejected' : 'unconfirmed'
      receiptState.errorCode =
        error.body?.code || error.code || 'COMMAND_UNCONFIRMED'
      try {
        await receipt.write(receiptState)
      } catch {}
    }
    reportCommandError(error, options)
  } finally {
    if (receipt) await receipt.close()
  }
}
