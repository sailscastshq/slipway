import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { APIError } from '../lib/api.js'
import { streamRequest } from '../lib/stream.js'
import {
  environmentPath,
  validateOutput,
  reportCommandError
} from '../lib/command-output.js'

export default async function run(options, positionals) {
  try {
    validateOutput(options)
    if (options.stdin && (positionals.length || options.file))
      throw new Error('--stdin cannot be combined with a command or --file.')
    if (options.file && positionals.length)
      throw new Error('--file cannot be combined with a command.')
    let code
    if (options.stdin) {
      const chunks = []
      let bytes = 0
      for await (const chunk of process.stdin) {
        bytes += chunk.length
        if (bytes > 128 * 1024)
          throw new Error('Command input exceeds 128 KiB.')
        chunks.push(chunk)
      }
      code = Buffer.concat(chunks).toString('utf8')
    } else if (options.file) code = await readFile(options.file, 'utf8')
    else code = positionals.join(' ')
    if (!code?.trim())
      throw new Error('Provide a command, --file <path>, or --stdin.')
    if (Buffer.byteLength(code) > 128 * 1024)
      throw new Error('Command input exceeds 128 KiB.')
    const executionId = randomUUID()
    let result
    const controller = new AbortController()
    const interrupt = () => controller.abort()
    process.once('SIGINT', interrupt)
    try {
      await streamRequest(`${environmentPath(options)}/helm/commands`, {
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
          ...(options['write-arm-file']
            ? {
                writeArmToken: (
                  await readFile(options['write-arm-file'], 'utf8')
                ).trim()
              }
            : {})
        },
        onEvent(event) {
          if (event.type === 'result') result = event.result
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
    reportCommandError(error, options)
  }
}
