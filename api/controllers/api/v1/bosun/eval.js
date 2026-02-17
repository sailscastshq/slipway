/**
 * eval.js
 *
 * Helm REPL endpoint for the Bosun dashboard.
 * Evaluates JavaScript/Waterline expressions in the Slipway process
 * with access to all models, helpers, and config.
 */

const vm = require('vm')
const util = require('util')

module.exports = {
  friendlyName: 'Bosun Helm eval',

  description: 'Evaluate a JavaScript expression with access to Slipway models and helpers.',

  inputs: {
    code: {
      type: 'string',
      required: true,
      description: 'JavaScript code to evaluate'
    }
  },

  exits: {
    success: {
      statusCode: 200
    },
    badRequest: {
      responseType: 'badRequest'
    }
  },

  fn: async function ({ code }) {
    const trimmed = code.trim()
    if (!trimmed) {
      throw { badRequest: 'Code cannot be empty.' }
    }

    // Auto-return last expression if no explicit return (REPL-style)
    let execCode = trimmed
    if (!/\breturn\b/.test(trimmed)) {
      const lines = trimmed.split('\n')
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim()
        if (line && !line.startsWith('//')) {
          lines[i] = 'return ' + lines[i]
          break
        }
      }
      execCode = lines.join('\n')
    }

    // Wrap in async function so await works
    const wrapped = `(async function() {\n${execCode}\n})()`

    // Build context with all Sails models as PascalCase globals
    const context = {
      sails,
      _: require('lodash'),
      console: {
        log: (...args) => { logs.push(args.map(a => formatValue(a)).join(' ')) },
        error: (...args) => { logs.push(args.map(a => formatValue(a)).join(' ')) },
        warn: (...args) => { logs.push(args.map(a => formatValue(a)).join(' ')) },
        info: (...args) => { logs.push(args.map(a => formatValue(a)).join(' ')) }
      },
      JSON,
      Date,
      Math,
      Promise,
      Buffer,
      setTimeout,
      clearTimeout,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Error,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent
    }

    // Inject all registered models as PascalCase globals
    for (const identity of Object.keys(sails.models)) {
      const model = sails.models[identity]
      context[model.globalId] = model
    }

    const logs = []
    const startTime = Date.now()

    try {
      const script = new vm.Script(wrapped, { timeout: 30000 })
      const sandbox = vm.createContext(context)
      const result = await script.runInContext(sandbox, { timeout: 30000 })
      const durationMs = Date.now() - startTime

      let output = ''
      if (logs.length > 0) {
        output += logs.join('\n') + '\n'
      }
      if (result !== undefined) {
        output += formatValue(result)
      }

      return {
        success: true,
        output: output || '(no output)',
        error: null,
        durationMs
      }
    } catch (err) {
      const durationMs = Date.now() - startTime
      let output = ''
      if (logs.length > 0) {
        output = logs.join('\n')
      }
      return {
        success: false,
        output: output || null,
        error: err.stack || err.message || String(err),
        durationMs
      }
    }
  }
}

function formatValue(val) {
  if (val === undefined) return 'undefined'
  if (val === null) return 'null'
  if (typeof val === 'string') return val
  if (typeof val === 'function') return '[Function: ' + (val.name || 'anonymous') + ']'
  if (typeof val === 'bigint') return val.toString() + 'n'
  if (typeof val === 'symbol') return val.toString()

  // First try plain JSON.stringify — works for Waterline query results
  // because records have toJSON() that strips internals
  try {
    return JSON.stringify(val, null, 2)
  } catch {
    // Circular refs or other issues — use a safe replacer
  }

  try {
    const seen = new WeakSet()
    return JSON.stringify(val, function (_key, value) {
      if (typeof value === 'function') return '[Function: ' + (value.name || 'anonymous') + ']'
      if (typeof value === 'bigint') return value.toString() + 'n'
      if (typeof value === 'symbol') return value.toString()
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]'
        seen.add(value)
      }
      return value
    }, 2)
  } catch {
    return util.inspect(val, { depth: 2 })
  }
}
