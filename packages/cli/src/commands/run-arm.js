import { api } from '../lib/api.js'
import { commandInput } from '../lib/command-input.js'
import { privateFile } from '../lib/private-file.js'
import { inspectedApp } from '../lib/app-target.js'
import {
  approveTarget,
  environmentPath,
  validateOutput,
  commandOutput,
  reportCommandError
} from '../lib/command-output.js'
export default async function arm(options, positionals) {
  let output
  try {
    validateOutput(options)
    const target = approveTarget(options)
    if (!options.output)
      throw new Error(
        'Specify --output <private-file> for the single-use arm. The token is never printed.'
      )
    const code = await commandInput(options, positionals)
    const app = await inspectedApp(options)
    if (app.status !== 'running' || !app.containerName)
      throw new Error('The selected app is not running.')
    output = await privateFile(options.output)
    const armed = await api.post(
      `${environmentPath(options)}/helm/arm-writes`,
      { mode: 'command', code, appSlug: options.app }
    )
    if (typeof armed.token !== 'string' || !armed.token || !armed.expiresAt)
      throw new Error('Unexpected write-arm response from Slipway.')
    await output.write(`${armed.token}\n`)
    commandOutput(
      options,
      {
        armed: true,
        target,
        armFile: options.output,
        sourceHash: armed.sourceHash,
        expiresAt: armed.expiresAt
      },
      [
        `Single-use arm saved to ${options.output}.`,
        `Expires: ${new Date(
          armed.expiresAt
        ).toISOString()}. Run only this exact command and deployment.`
      ]
    )
  } catch (error) {
    reportCommandError(error, options)
  } finally {
    if (output) await output.close()
  }
}
