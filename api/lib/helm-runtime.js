const acorn = require('acorn')

const START_MARKER = '___SLIPWAY_HELM_RESULT_START___'
const END_MARKER = '___SLIPWAY_HELM_RESULT_END___'
const VIRTUAL_FILENAME = 'helm-input.js'
const MAX_SOURCE_COORDINATE = 1_000_000

function prepareSource(
  source,
  {
    maxSourceBytes = 64 * 1024,
    sourceStartLine = 1,
    sourceStartColumn = 1
  } = {}
) {
  const submittedSource = String(source || '')
  const sourceBytes = Buffer.byteLength(submittedSource)
  const origin = normalizeSourceOrigin({
    sourceStartLine,
    sourceStartColumn
  })

  if (!submittedSource.trim()) {
    throw sourceError('Code cannot be empty.', {
      name: 'HelmSourceError',
      line: origin.line,
      column: origin.column
    })
  }

  if (sourceBytes > maxSourceBytes) {
    throw sourceError(
      `Code exceeds the ${formatBytes(maxSourceBytes)} Helm source limit.`,
      {
        name: 'HelmSourceError',
        line: origin.line,
        column: origin.column
      }
    )
  }

  const prefix = 'async function __helmInput__() {\n'
  const suffix = '\n}'
  let program

  try {
    program = acorn.parse(`${prefix}${submittedSource}${suffix}`, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true
    })
  } catch (error) {
    const submittedLineCount = submittedSource.split('\n').length
    const line = Math.min(
      submittedLineCount,
      Math.max(1, (error.loc?.line || 2) - 1)
    )
    const column = (error.loc?.column || 0) + 1
    const location = mapSourceLocation(line, column, origin)
    throw sourceError(cleanParserMessage(error.message), {
      name: error.name || 'SyntaxError',
      line: location.line,
      column: location.column,
      cause: error
    })
  }

  const statements = program.body[0].body.body
  const finalStatement = statements.at(-1)

  if (!finalStatement || finalStatement.type !== 'ExpressionStatement') {
    return {
      source: submittedSource,
      finalExpression: null
    }
  }

  const statementStart = finalStatement.start - prefix.length
  const statementEnd = finalStatement.end - prefix.length
  const expressionStart = finalStatement.expression.start - prefix.length
  const expressionEnd = finalStatement.expression.end - prefix.length
  const expression = submittedSource.slice(expressionStart, expressionEnd)
  const replacement = `return (${expression});`

  return {
    source:
      submittedSource.slice(0, statementStart) +
      replacement +
      submittedSource.slice(statementEnd),
    finalExpression: {
      ...mapSourceLocation(
        finalStatement.loc.start.line - 1,
        finalStatement.loc.start.column + 1,
        origin
      ),
      addedColumns: 'return ('.length
    }
  }
}

function buildRunnerSource({
  preparedSource,
  finalExpression,
  sourceStartLine = 1,
  sourceStartColumn = 1,
  bootstrapSails = true,
  timeoutMs = 30000,
  maxLogBytes = 64 * 1024,
  maxResultBytes = 128 * 1024
}) {
  return `(${helmSubprocessMain.toString()})(${JSON.stringify({
    preparedSource,
    finalExpression,
    sourceStartLine,
    sourceStartColumn,
    bootstrapSails,
    timeoutMs,
    maxLogBytes,
    maxResultBytes,
    startMarker: START_MARKER,
    endMarker: END_MARKER,
    filename: VIRTUAL_FILENAME
  })})`
}

function parseRunnerOutput(stdout) {
  const output = String(stdout || '')
  const start = output.lastIndexOf(START_MARKER)
  const end = output.indexOf(END_MARKER, start + START_MARKER.length)

  if (start === -1 || end === -1) {
    const error = new Error('Helm runner did not return a result envelope.')
    error.code = 'HELM_RESULT_MISSING'
    throw error
  }

  const payload = output.slice(start + START_MARKER.length, end)
  return JSON.parse(payload)
}

function createFailureResult(error, durationMs = 0) {
  const normalized = normalizeHostError(error)
  return {
    success: false,
    value: null,
    logs: [],
    output: null,
    error: normalized,
    durationMs,
    truncated: false
  }
}

function normalizeHostError(error) {
  const name = error?.name || 'Error'
  const message = error?.message || String(error)
  const line = numberOrNull(error?.line)
  const column = numberOrNull(error?.column)

  return {
    name,
    message,
    stack:
      line && column
        ? `${name}: ${message}\n    at ${VIRTUAL_FILENAME}:${line}:${column}`
        : error?.stack || null,
    filename: line && column ? VIRTUAL_FILENAME : null,
    line,
    column
  }
}

function sourceError(message, { name, line, column, cause }) {
  const error = new Error(message, cause ? { cause } : undefined)
  error.name = name
  error.code = 'HELM_SOURCE_INVALID'
  error.line = line
  error.column = column
  return error
}

function normalizeSourceOrigin({ sourceStartLine, sourceStartColumn }) {
  return {
    line: normalizeSourceCoordinate(sourceStartLine, 'line'),
    column: normalizeSourceCoordinate(sourceStartColumn, 'column')
  }
}

function normalizeSourceCoordinate(value, label) {
  const coordinate = Number(value)

  if (
    !Number.isSafeInteger(coordinate) ||
    coordinate < 1 ||
    coordinate > MAX_SOURCE_COORDINATE
  ) {
    throw sourceError(
      `Source start ${label} must be an integer between 1 and ${MAX_SOURCE_COORDINATE}.`,
      {
        name: 'HelmSourceError',
        line: 1,
        column: 1
      }
    )
  }

  return coordinate
}

function mapSourceLocation(line, column, origin) {
  return {
    line: origin.line + line - 1,
    column: line === 1 ? origin.column + column - 1 : column
  }
}

function cleanParserMessage(message) {
  return String(message || 'Invalid JavaScript.').replace(/\s+\(\d+:\d+\)$/, '')
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

async function helmSubprocessMain(options) {
  const vm = require('node:vm')
  const startedAt = Date.now()
  let sailsApp
  let resultSent = false
  let shutdownStarted = false
  let resultWritePromise = Promise.resolve()
  const logs = []
  let logBytes = 0
  let logsTruncated = false

  const timeoutError = () => {
    const error = new Error(
      `Helm execution timed out after ${options.timeoutMs}ms.`
    )
    error.name = 'TimeoutError'
    error.code = 'HELM_TIMEOUT'
    return error
  }

  const hardTimeout = setTimeout(() => {
    sendResult(failureResult(timeoutError()))
    void shutdown()
  }, options.timeoutMs)

  try {
    if (options.bootstrapSails) {
      sailsApp = require('sails')
      await new Promise((resolve, reject) => {
        sailsApp.load(
          {
            environment: 'console',
            bootstrap(done) {
              done()
            },
            hooks: {
              http: false,
              views: false,
              sockets: false,
              pubsub: false,
              grunt: false,
              flash: false,
              session: false,
              shipwright: false,
              content: false,
              dev: false
            },
            security: {
              csrf: false
            },
            log: { level: 'silent' }
          },
          (error) => {
            if (error) reject(error)
            else resolve()
          }
        )
      })
    }

    const recordLog = (...values) => {
      if (logsTruncated) return

      const formatted = values
        .map((value) => formatValue(value, options.maxLogBytes))
        .join(' ')
      const separatorBytes = logs.length > 0 ? 1 : 0
      const remaining = options.maxLogBytes - logBytes - separatorBytes

      if (remaining <= 0) {
        logsTruncated = true
        return
      }

      const bounded = truncateUtf8(formatted, remaining)
      logs.push(bounded.value)
      logBytes += separatorBytes + Buffer.byteLength(bounded.value)
      logsTruncated ||= bounded.truncated
    }

    const context = {
      sails: sailsApp,
      _: sailsApp?.util?._,
      console: {
        log: recordLog,
        error: recordLog,
        warn: recordLog,
        info: recordLog,
        debug: recordLog
      },
      JSON,
      Date,
      Math,
      Promise,
      Buffer,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      setImmediate,
      clearImmediate,
      queueMicrotask,
      Array,
      Object,
      String,
      Number,
      Boolean,
      BigInt,
      RegExp,
      Error,
      TypeError,
      RangeError,
      Map,
      Set,
      WeakMap,
      WeakSet,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      encodeURIComponent,
      decodeURIComponent
    }

    for (const identity of Object.keys(sailsApp?.models || {})) {
      const model = sailsApp.models[identity]
      if (model.globalId) context[model.globalId] = model
    }

    const firstLinePadding = ' '.repeat(options.sourceStartColumn - 1)
    const wrappedSource = `(async function () {\n${firstLinePadding}${options.preparedSource}\n})()`
    const script = new vm.Script(wrappedSource, {
      filename: options.filename,
      lineOffset: options.sourceStartLine - 2,
      displayErrors: true
    })
    const sandbox = vm.createContext(context)
    const remainingMs = Math.max(
      1,
      options.timeoutMs - (Date.now() - startedAt)
    )
    const value = await script.runInContext(sandbox, {
      timeout: remainingMs,
      displayErrors: true
    })
    const valueResult = formatResultValue(value, options.maxResultBytes)
    const outputParts = [...logs]

    if (value !== undefined) outputParts.push(valueResult.output)

    sendResult({
      success: true,
      value: valueResult.value,
      logs,
      output: outputParts.join('\n') || '(no output)',
      error: null,
      durationMs: Date.now() - startedAt,
      truncated: logsTruncated || valueResult.truncated
    })
  } catch (error) {
    sendResult(failureResult(isVmTimeout(error) ? timeoutError() : error))
  } finally {
    clearTimeout(hardTimeout)
    await shutdown()
  }

  function failureResult(error) {
    return {
      success: false,
      value: null,
      logs,
      output: logs.join('\n') || null,
      error: normalizeRuntimeError(error, options),
      durationMs: Date.now() - startedAt,
      truncated: logsTruncated
    }
  }

  function sendResult(result) {
    if (resultSent) return
    resultSent = true

    let serialized = JSON.stringify(result)
    const bounded = truncateEnvelope(serialized, result, options.maxResultBytes)
    serialized = bounded.serialized

    resultWritePromise = new Promise((resolve) => {
      process.stdout.write(
        `${options.startMarker}${serialized}${options.endMarker}`,
        resolve
      )
    })
  }

  async function shutdown() {
    if (shutdownStarted) return
    shutdownStarted = true
    await resultWritePromise

    if (sailsApp?.lower) {
      try {
        await Promise.race([
          new Promise((resolve) => sailsApp.lower(() => resolve())),
          new Promise((resolve) => setTimeout(resolve, 250))
        ])
      } catch {
        // The process is isolated and must still terminate if lowering fails.
      }
    }

    process.exit(0)
  }

  function formatResultValue(value, maxBytes) {
    if (value === undefined) {
      return {
        value: { type: 'undefined' },
        output: 'undefined',
        truncated: false
      }
    }

    if (typeof value === 'string') {
      const bounded = truncateUtf8(value, maxBytes)
      return {
        value: bounded.value,
        output: bounded.value,
        truncated: bounded.truncated
      }
    }

    const state = {
      seen: new WeakMap(),
      nextReference: 1,
      entries: 0,
      maxEntries: 500,
      maxDepth: 8,
      maxStringBytes: Math.min(maxBytes, 32 * 1024),
      truncated: false
    }
    const snapshot = snapshotValue(value, state, 0)
    const serialized = JSON.stringify(snapshot, null, 2)
    const bounded = truncateUtf8(serialized, maxBytes)

    return {
      value: bounded.truncated
        ? {
            type: 'truncated',
            preview: bounded.value
          }
        : snapshot,
      output: bounded.value,
      truncated: state.truncated || bounded.truncated
    }
  }

  function formatValue(value, maxBytes) {
    if (value === undefined) return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'string') return truncateUtf8(value, maxBytes).value

    const state = {
      seen: new WeakMap(),
      nextReference: 1,
      entries: 0,
      maxEntries: 100,
      maxDepth: 5,
      maxStringBytes: Math.min(maxBytes, 8 * 1024),
      truncated: false
    }
    return truncateUtf8(
      JSON.stringify(snapshotValue(value, state, 0), null, 2),
      maxBytes
    ).value
  }

  function snapshotValue(value, state, depth) {
    if (value === undefined) return { type: 'undefined' }
    if (value === null) return null

    const valueType = typeof value
    if (valueType === 'string') {
      const bounded = truncateUtf8(value, state.maxStringBytes)
      state.truncated ||= bounded.truncated
      return bounded.value
    }
    if (valueType === 'boolean') return value
    if (valueType === 'number') {
      return Number.isFinite(value)
        ? value
        : { type: 'Number', value: String(value) }
    }
    if (valueType === 'bigint') {
      return { type: 'BigInt', value: value.toString() }
    }
    if (valueType === 'symbol') {
      return { type: 'Symbol', value: value.description || '' }
    }
    if (valueType === 'function') {
      return { type: 'Function', name: value.name || 'anonymous' }
    }

    if (depth >= state.maxDepth || state.entries >= state.maxEntries) {
      state.truncated = true
      return '[Truncated]'
    }

    if (state.seen.has(value)) {
      return `[Circular ~${state.seen.get(value)}]`
    }

    state.seen.set(value, state.nextReference++)

    const descriptors = safeDescriptors(value)
    const waterlineToJSON = descriptors.toJSON
    if (
      waterlineToJSON &&
      waterlineToJSON.enumerable === false &&
      typeof waterlineToJSON.value === 'function'
    ) {
      try {
        const serializableValue = Reflect.apply(
          waterlineToJSON.value,
          value,
          []
        )
        if (serializableValue !== value) {
          return snapshotValue(serializableValue, state, depth)
        }
      } catch {
        // A broken custom serializer must not prevent Helm from showing the
        // record's enumerable data.
      }
    }

    if (value instanceof Date) {
      const timestamp = value.getTime()
      return {
        type: 'Date',
        value: Number.isNaN(timestamp) ? 'Invalid Date' : value.toISOString()
      }
    }

    if (value instanceof Error) {
      return {
        type: 'Error',
        name: safeString(readErrorProperty(value, 'name', 'Error'), 'Error'),
        message: truncateUtf8(
          safeString(readErrorProperty(value, 'message', ''), ''),
          state.maxStringBytes
        ).value,
        stack: truncateUtf8(
          safeString(readErrorProperty(value, 'stack', ''), ''),
          state.maxStringBytes
        ).value
      }
    }

    if (value instanceof Map) {
      const entries = []
      for (const [key, entryValue] of Map.prototype.entries.call(value)) {
        if (state.entries++ >= state.maxEntries) {
          state.truncated = true
          break
        }
        entries.push([
          snapshotValue(key, state, depth + 1),
          snapshotValue(entryValue, state, depth + 1)
        ])
      }
      return { type: 'Map', entries }
    }

    if (value instanceof Set) {
      const values = []
      for (const entryValue of Set.prototype.values.call(value)) {
        if (state.entries++ >= state.maxEntries) {
          state.truncated = true
          break
        }
        values.push(snapshotValue(entryValue, state, depth + 1))
      }
      return { type: 'Set', values }
    }

    if (Array.isArray(value)) {
      const array = []
      const length = Math.min(value.length, state.maxEntries - state.entries)

      for (let index = 0; index < length; index++) {
        state.entries++
        const descriptor = descriptors[String(index)]
        array.push(
          descriptor && 'value' in descriptor
            ? snapshotValue(descriptor.value, state, depth + 1)
            : descriptor
            ? '[Getter]'
            : null
        )
      }

      if (length < value.length) state.truncated = true
      return array
    }

    const output = {}

    for (const key of Object.keys(descriptors)) {
      if (!descriptors[key].enumerable) continue

      if (state.entries++ >= state.maxEntries) {
        state.truncated = true
        break
      }

      const descriptor = descriptors[key]
      output[key] =
        'value' in descriptor
          ? snapshotValue(descriptor.value, state, depth + 1)
          : descriptor.get
          ? '[Getter]'
          : '[Setter]'
    }

    return output
  }

  function safeDescriptors(value) {
    try {
      return Object.getOwnPropertyDescriptors(value)
    } catch (error) {
      return {
        error: {
          configurable: true,
          enumerable: true,
          value: `[Uninspectable: ${safeString(
            error?.message,
            'unknown error'
          )}]`,
          writable: true
        }
      }
    }
  }

  function normalizeRuntimeError(error, runtimeOptions) {
    const primitiveMessage =
      error !== null &&
      error !== undefined &&
      typeof error !== 'object' &&
      typeof error !== 'function'
        ? safeString(error, 'Execution failed.')
        : null
    const name = truncateUtf8(
      safeString(readErrorProperty(error, 'name', 'Error'), 'Error'),
      256
    ).value
    const message = truncateUtf8(
      safeString(
        readErrorProperty(
          error,
          'message',
          primitiveMessage || 'Execution failed.'
        ),
        ''
      ),
      Math.floor(runtimeOptions.maxResultBytes / 8)
    ).value
    let stack = truncateUtf8(
      safeString(readErrorProperty(error, 'stack', ''), ''),
      Math.floor(runtimeOptions.maxResultBytes / 4)
    ).value
    let line = null
    let column = null
    const locationPattern = new RegExp(
      `${escapeRegExp(runtimeOptions.filename)}:(\\d+):(\\d+)`
    )
    const location = stack?.match(locationPattern)

    if (location) {
      line = Number(location[1])
      column = Number(location[2])

      if (
        runtimeOptions.finalExpression &&
        line === runtimeOptions.finalExpression.line &&
        column >=
          runtimeOptions.finalExpression.column +
            runtimeOptions.finalExpression.addedColumns
      ) {
        const mappedColumn =
          column - runtimeOptions.finalExpression.addedColumns
        stack = stack.replace(
          `${runtimeOptions.filename}:${line}:${column}`,
          `${runtimeOptions.filename}:${line}:${mappedColumn}`
        )
        column = mappedColumn
      }
    }

    return {
      name,
      message,
      stack,
      filename: line && column ? runtimeOptions.filename : null,
      line,
      column
    }
  }

  function truncateEnvelope(serialized, result, maxBytes) {
    if (Buffer.byteLength(serialized) <= maxBytes) {
      return { serialized, truncated: false }
    }

    const compact = {
      ...result,
      value: { type: 'truncated' },
      logs: [],
      output: truncateUtf8(result.output || '', Math.floor(maxBytes / 8)).value,
      truncated: true
    }
    if (compact.error?.stack) {
      compact.error = {
        ...compact.error,
        name: truncateUtf8(compact.error.name, 256).value,
        message: truncateUtf8(compact.error.message, Math.floor(maxBytes / 16))
          .value,
        stack: truncateUtf8(compact.error.stack, Math.floor(maxBytes / 8)).value
      }
    }

    const compactSerialized = JSON.stringify(compact)
    if (Buffer.byteLength(compactSerialized) <= maxBytes) {
      return {
        serialized: compactSerialized,
        truncated: true
      }
    }

    return {
      serialized: JSON.stringify({
        success: result.success,
        value: { type: 'truncated' },
        logs: [],
        output: '… output truncated',
        error: compact.error
          ? {
              name: truncateUtf8(compact.error.name, 256).value,
              message: truncateUtf8(compact.error.message, 2048).value,
              stack: null,
              line: compact.error.line,
              column: compact.error.column
            }
          : null,
        durationMs: result.durationMs,
        truncated: true
      }),
      truncated: true
    }
  }

  function truncateUtf8(value, maxBytes) {
    const string = String(value)
    const buffer = Buffer.from(string)

    if (buffer.length <= maxBytes) {
      return { value: string, truncated: false }
    }

    const suffix = '\n... output truncated'
    const suffixBytes = Buffer.byteLength(suffix)
    if (maxBytes <= suffixBytes) {
      return {
        value: suffix.slice(0, Math.max(0, maxBytes)),
        truncated: true
      }
    }

    const contentBytes = Math.max(0, maxBytes - suffixBytes)
    return {
      value: buffer.subarray(0, contentBytes).toString('utf8') + suffix,
      truncated: true
    }
  }

  function isVmTimeout(error) {
    return (
      readDataProperty(error, 'code', null) ===
        'ERR_SCRIPT_EXECUTION_TIMEOUT' ||
      /Script execution timed out/.test(
        readDataProperty(error, 'message', '') || ''
      )
    )
  }

  function readDataProperty(value, property, fallback) {
    let current = value

    try {
      while (current) {
        const descriptor = Object.getOwnPropertyDescriptor(current, property)
        if (descriptor) {
          return 'value' in descriptor ? descriptor.value : fallback
        }
        current = Object.getPrototypeOf(current)
      }
    } catch {
      return fallback
    }

    return fallback
  }

  function readErrorProperty(error, property, fallback) {
    if (error instanceof Error || property === 'stack') {
      try {
        const value = error[property]
        return value === undefined || value === null ? fallback : value
      } catch {
        return fallback
      }
    }

    return readDataProperty(error, property, fallback)
  }

  function safeString(value, fallback) {
    try {
      return value === undefined || value === null ? fallback : String(value)
    } catch {
      return fallback
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

module.exports = {
  END_MARKER,
  START_MARKER,
  VIRTUAL_FILENAME,
  buildRunnerSource,
  createFailureResult,
  parseRunnerOutput,
  prepareSource
}
