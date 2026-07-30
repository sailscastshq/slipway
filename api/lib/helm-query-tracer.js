module.exports = function createHelmQueryTracer({
  sailsApp,
  queryTrace,
  queryTraceContext,
  maxEntries
}) {
  const tracedMethods = [
    'addToCollection',
    'archive',
    'archiveOne',
    'avg',
    'count',
    'create',
    'createEach',
    'destroy',
    'destroyOne',
    'find',
    'findOne',
    'findOrCreate',
    'removeFromCollection',
    'replaceCollection',
    'stream',
    'sum',
    'update',
    'updateOne'
  ]

  for (const identity of Object.keys(sailsApp.models || {})) {
    const model = sailsApp.models[identity]

    for (const method of tracedMethods) {
      const original = model[method]
      if (typeof original !== 'function') continue

      model[method] = function (...originalArgs) {
        const args = [...originalArgs]
        const callbackIndex = args.findIndex(
          (argument) => typeof argument === 'function'
        )

        if (callbackIndex !== -1) {
          const started = Date.now()
          const callback = args[callbackIndex]
          args[callbackIndex] = function (error, ...values) {
            recordWaterlineTrace({
              model,
              method,
              queryInfo: initialQueryInfo(method, originalArgs),
              started,
              error
            })
            return Reflect.apply(callback, this, [error, ...values])
          }

          try {
            return Reflect.apply(original, this, args)
          } catch (error) {
            recordWaterlineTrace({
              model,
              method,
              queryInfo: initialQueryInfo(method, originalArgs),
              started,
              error
            })
            throw error
          }
        }

        const deferred = Reflect.apply(original, this, args)
        return instrumentWaterlineDeferred(deferred, model, method)
      }
    }
  }

  instrumentNativeDatastores()

  function instrumentWaterlineDeferred(deferred, model, fallbackMethod) {
    if (!deferred || typeof deferred._handleExec !== 'function') {
      return deferred
    }

    const originalHandleExec = deferred._handleExec
    deferred._handleExec = function (done) {
      const started = Date.now()
      const criteria = deferred._wlQueryInfo?.criteria
        ? redactQueryStructure(deferred._wlQueryInfo.criteria)
        : null
      return Reflect.apply(originalHandleExec, this, [
        function (error, ...values) {
          recordWaterlineTrace({
            model,
            method: deferred._wlQueryInfo?.method || fallbackMethod,
            criteria,
            started,
            error
          })
          return done(error, ...values)
        }
      ])
    }
    return deferred
  }

  function instrumentNativeDatastores() {
    const originalGetDatastore = sailsApp.getDatastore
    const instrumentedDatastores = new WeakSet()
    sailsApp.getDatastore = function (name) {
      const datastore = Reflect.apply(originalGetDatastore, this, arguments)
      return instrumentDatastore(datastore, name || 'default')
    }

    for (const datastoreName of Object.keys(
      sailsApp.config.datastores || { default: {} }
    )) {
      try {
        instrumentDatastore(
          Reflect.apply(originalGetDatastore, sailsApp, [datastoreName]),
          datastoreName
        )
      } catch {
        // An unavailable datastore is unrelated to tracing another datastore.
      }
    }

    function instrumentDatastore(datastore, datastoreName) {
      if (
        !datastore ||
        instrumentedDatastores.has(datastore) ||
        typeof datastore.sendNativeQuery !== 'function'
      ) {
        return datastore
      }

      instrumentedDatastores.add(datastore)
      const originalSendNativeQuery = datastore.sendNativeQuery
      datastore.sendNativeQuery = function (statement, ...originalArgs) {
        const args = [...originalArgs]
        const callbackIndex = args.findIndex(
          (argument) => typeof argument === 'function'
        )
        const started = Date.now()

        if (callbackIndex !== -1) {
          const callback = args[callbackIndex]
          args[callbackIndex] = function (error, ...values) {
            recordNativeTrace({
              datastoreName,
              statement,
              started,
              error
            })
            return Reflect.apply(callback, this, [error, ...values])
          }
        }

        let operation
        try {
          operation = Reflect.apply(originalSendNativeQuery, this, [
            statement,
            ...args
          ])
        } catch (error) {
          recordNativeTrace({
            datastoreName,
            statement,
            started,
            error
          })
          throw error
        }

        if (
          callbackIndex === -1 &&
          operation &&
          typeof operation.then === 'function'
        ) {
          return Promise.resolve(operation).then(
            (value) => {
              recordNativeTrace({
                datastoreName,
                statement,
                started,
                error: null
              })
              return value
            },
            (error) => {
              recordNativeTrace({
                datastoreName,
                statement,
                started,
                error
              })
              throw error
            }
          )
        }

        return operation
      }

      return datastore
    }
  }

  function recordWaterlineTrace({
    model,
    method,
    queryInfo,
    criteria,
    started,
    error
  }) {
    record({
      kind: 'waterline',
      model: safeIdentifier(model?.identity || queryInfo?.using, 'unknown'),
      datastore: safeIdentifier(model?.datastore, 'default'),
      method: safeIdentifier(method, 'query'),
      durationMs: Math.max(0, Date.now() - started),
      status: error ? 'error' : 'success',
      criteria:
        criteria ||
        (queryInfo?.criteria ? redactQueryStructure(queryInfo.criteria) : null)
    })
  }

  function recordNativeTrace({ datastoreName, statement, started, error }) {
    record({
      kind: 'native',
      model: null,
      datastore: safeIdentifier(datastoreName, 'default'),
      method: 'sendNativeQuery',
      durationMs: Math.max(0, Date.now() - started),
      status: error ? 'error' : 'success',
      statement: sanitizeSql(statement)
    })
  }

  function record(entry) {
    if (queryTraceContext.getStore() !== true) return
    if (queryTrace.entries.length >= maxEntries) {
      queryTrace.omittedCount++
      return
    }
    queryTrace.entries.push(entry)
  }

  function initialQueryInfo(method, args) {
    if (
      [
        'archive',
        'archiveOne',
        'avg',
        'count',
        'destroy',
        'destroyOne',
        'find',
        'findOne',
        'findOrCreate',
        'sum',
        'update',
        'updateOne'
      ].includes(method)
    ) {
      return { criteria: args[0] }
    }
    return null
  }

  function redactQueryStructure(value, depth = 0) {
    if (value === null || value === undefined) return '[value]'
    if (depth >= 6) return '[nested]'
    if (Array.isArray(value)) {
      const redacted = value
        .slice(0, 12)
        .map((entry) => redactQueryStructure(entry, depth + 1))
      if (value.length > redacted.length) redacted.push('[more]')
      return redacted
    }
    if (typeof value !== 'object') return '[value]'

    const output = {}
    const descriptors = safeDescriptors(value)
    const entries = Object.entries(descriptors).slice(0, 40)
    for (const [unsafeKey, descriptor] of entries) {
      if (!descriptor.enumerable) continue
      const key = /^[A-Za-z0-9_.$:<>!=-]{1,80}$/.test(unsafeKey)
        ? unsafeKey
        : '[key]'
      output[key] =
        'value' in descriptor
          ? redactQueryStructure(descriptor.value, depth + 1)
          : '[value]'
    }
    if (Object.keys(descriptors).length > entries.length) {
      output['[more]'] = '[nested]'
    }
    return output
  }

  function sanitizeSql(value) {
    let statement = safeString(value, '')
      .slice(0, 32 * 1024)
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/--[^\r\n]*/g, ' ')
      .replace(
        /\$[A-Za-z_][A-Za-z0-9_]*\$[\s\S]*?\$[A-Za-z_][A-Za-z0-9_]*\$/g,
        '?'
      )
      .replace(/\$\$[\s\S]*?\$\$/g, '?')
      .replace(/'(?:''|\\.|[^'])*'/g, '?')
      .replace(/"(?:\"\"|\\.|[^"])*"/g, '?')
      .replace(/`(?:``|\\.|[^`])*`/g, '?')
      .replace(/\b(?:0x[0-9a-f]+|\d+(?:\.\d+)?)\b/gi, '?')
      .replace(/\s+/g, ' ')
      .trim()

    if (!statement) statement = '[redacted statement]'
    return truncateUtf8(statement, 512)
  }

  function safeIdentifier(value, fallback) {
    const identifier = safeString(value, fallback)
    return /^[A-Za-z0-9_.:-]{1,120}$/.test(identifier) ? identifier : fallback
  }

  function safeDescriptors(value) {
    try {
      return Object.getOwnPropertyDescriptors(value)
    } catch {
      return {}
    }
  }

  function safeString(value, fallback) {
    try {
      return value === undefined || value === null ? fallback : String(value)
    } catch {
      return fallback
    }
  }

  function truncateUtf8(value, maxBytes) {
    const string = String(value)
    const buffer = Buffer.from(string)
    return buffer.length <= maxBytes
      ? string
      : `${buffer.subarray(0, Math.max(0, maxBytes - 1)).toString('utf8')}…`
  }
}
