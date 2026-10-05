const crypto = require('node:crypto')

/**
 * Parse one non-interactive command into argv. This is deliberately not a shell:
 * quotes and backslash escapes group arguments, but operators, substitutions,
 * redirects, and leading environment assignments are not evaluated.
 */
function parseCommand(source, { maxBytes = 64 * 1024, maxArgs = 128 } = {}) {
  if (typeof source !== 'string' || !source.trim()) {
    throw invalid('Enter a command to run.')
  }
  if (Buffer.byteLength(source) > maxBytes) {
    throw invalid(`Command exceeds the ${maxBytes}-byte limit.`)
  }
  // Catch the common mode mix-up before an execution is inspected or armed.
  // Only inspect the leading executable, never JavaScript inside CLI arguments.
  if (
    /^\s*(?:await\s+|(?:const|let|var|return)\s+|[A-Z][\w$]*\.[\w$.]+\s*\()/u.test(
      source
    )
  ) {
    throw invalid(
      'Use JavaScript mode for queries such as await User.find(). Command mode runs an executable, such as node --version.'
    )
  }
  if (/[\0\r\n]/.test(source)) {
    throw invalid(
      'Enter one command on one line; multiline commands are not supported.'
    )
  }

  const args = []
  let value = ''
  let quote = null
  let started = false
  let escaped = false
  const finish = () => {
    if (!started) return
    args.push(value)
    if (args.length > maxArgs)
      throw invalid(`Command exceeds the ${maxArgs}-argument limit.`)
    value = ''
    started = false
  }

  for (const character of source) {
    if (escaped) {
      value += character
      started = true
      escaped = false
    } else if (character === '\\' && quote !== "'") {
      escaped = true
      started = true
    } else if (quote) {
      if (character === quote) quote = null
      else value += character
    } else if (character === "'" || character === '"') {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      finish()
    } else if (/[;&|<>`]/.test(character)) {
      throw invalid(
        'Shell operators are not supported. Run a single command or an app-owned script.'
      )
    } else {
      value += character
      started = true
    }
  }
  if (escaped || quote)
    throw invalid('Finish the quoted argument or backslash escape.')
  finish()
  if (!args[0]) throw invalid('The command executable cannot be empty.')
  if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
    throw invalid(
      'Environment assignments are not supported. Configure the selected app environment instead.'
    )
  }
  if (/^(?:.*[/\\])?npx(?:\.cmd)?$/i.test(args[0])) {
    throw invalid(
      'Use the installed command directly. For Sails scripts, use sails run; Helm never downloads a CLI through npx.'
    )
  }
  return args
}

function hashCommand(source) {
  // Domain separation prevents a command arm from authorizing JavaScript with
  // the same text (or vice versa). The exact source remains part of the grant.
  return crypto
    .createHash('sha256')
    .update('helm-command-v1\0')
    .update(source)
    .digest('hex')
}

function classifyCommand(source, options) {
  const args = parseCommand(source, options)
  return {
    mutating: true,
    complete: false,
    findings: [
      {
        kind: 'command',
        method: args[0],
        label: `Command can have side effects: ${args[0]}`,
        line: 1,
        column: 1
      }
    ]
  }
}

function invalid(message) {
  const error = new Error(message)
  error.code = 'HELM_COMMAND_INVALID'
  return error
}

module.exports = { parseCommand, hashCommand, classifyCommand }
