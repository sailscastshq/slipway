const { createRedactor } = require('../../helpers/security/redact')._private

module.exports = function secretsHook(sails) {
  const redact = createRedactor()
  const credentials = createRedactor({
    context: 'response',
    diagnostics: redact
  })
  function remember(value) {
    redact.remember(value)
    credentials.remember(value)
  }
  // Only intentional credential fields from successful, authenticated actions
  // bypass masking. Errors from the same actions still go through redaction.
  const grants = {
    'api/v1/configuration/reveal': ['value'],
    'api/v1/cli/check-auth': ['token'],
    'api/v1/cli/stream-auth': ['token'],
    'api/v1/cli/init-auth': ['deviceCode'],
    'api/v1/deploy-token/create': ['token', 'tokenPrefix'],
    'api/v1/helm/arm-writes': ['token'],
    'api/v1/bridge/exchange': ['launchUrl'],
    'api/v1/bearing/exchange': ['launchUrl'],
    'project/bridge-action-context': ['conditionToken'],
    'project/bridge-prepare-upload-field': ['uploadUrl'],
    'project/bridge-resume-upload-field': ['uploadUrl']
  }
  function response(req, res, value) {
    const result =
      res.statusCode >= 400 || value instanceof Error
        ? redact.protect(value)
        : credentials.protect(value)
    if (
      req.options?.action === 'auth/view-reset-password' &&
      value?.props?.token &&
      res.statusCode === 200
    ) {
      result.props.token = value.props.token
      res.set('Cache-Control', 'private, no-store')
    }
    if (
      ['bearing/view-surface', 'bearing/view-feedback'].includes(
        req.options?.action
      ) &&
      res.statusCode === 200 &&
      value?.props?.realtime?.token
    ) {
      // The existing issuer binds this short-lived token to the space and origin.
      // Preserve only that capability; keep every other prop redacted.
      result.props.realtime.token = value.props.realtime.token
    }
    const fields = grants[req.options?.action]
    if (
      fields &&
      res.statusCode >= 200 &&
      res.statusCode < 300 &&
      value &&
      !value.error &&
      !value.message
    ) {
      res.set('Cache-Control', 'private, no-store')
      for (const field of fields)
        if (Object.hasOwn(value, field)) result[field] = value[field]
      if (
        [
          'project/bridge-prepare-upload-field',
          'project/bridge-resume-upload-field'
        ].includes(req.options.action) &&
        Array.isArray(value.parts)
      )
        result.parts = value.parts.map(({ partNumber, uploadUrl }) => ({
          partNumber,
          uploadUrl
        }))
    }
    return result
  }
  const hook = {
    remember,
    protect: redact.protect,
    text: redact.text,
    stream: redact.stream,
    initialize(done) {
      sails.after('hook:orm:loaded', async () => {
        let section = 'instance configuration'
        try {
          remember({ secret: sails.config.session?.secret })
          remember(sails.config.custom || {})
          remember({
            accessKey: sails.config.uploads?.key,
            secret: sails.config.uploads?.secret
          })
          for (const name of [
            'app',
            'environment',
            'service',
            'setting',
            'project',
            'gitprovider'
          ]) {
            section = `${name} records`
            const model = sails.models[name]
            if (!model) continue
            const fields = Object.keys(model.attributes).filter(
              (key) =>
                model.attributes[key].encrypt ||
                /password|secret|token|credential|encrypted|envVars|envVarMetadata|key/i.test(
                  key
                )
            )
            // Older settings may still use the supported plaintext value column.
            if (name === 'setting') fields.push('value')
            for (let offset = 0; ; offset += 100) {
              const records = await model
                .find()
                .select(fields)
                .sort('id ASC')
                .skip(offset)
                .limit(100)
                .decrypt()
              records.forEach(remember)
              if (records.length < 100) break
            }
          }
          for (const level of [
            'error',
            'warn',
            'info',
            'debug',
            'verbose',
            'silly'
          ]) {
            const original = sails.log[level]
            sails.log[level] = (...args) =>
              original.apply(
                sails.log,
                args.map((value) => redact.protect(value))
              )
          }
          done()
        } catch {
          done(
            new Error(
              `Could not initialize secret-safe diagnostics from ${section}. Check database access and the data encryption key.`
            )
          )
        }
      })
    },
    routes: {
      before: {
        '/*': function (req, res, next) {
          const json = res.json
          res.json = function (value) {
            return json.call(this, response(req, res, value))
          }
          const view = res.view
          res.view = function (name, locals, ...args) {
            if (locals?.page) {
              const originalPage = locals.page
              const page = response(req, res, originalPage)
              locals = {
                ...locals,
                page,
                // SSR was rendered before this response boundary. If props were
                // sanitized, discard that HTML and let Inertia render the safe
                // page in the browser. Never do substring surgery on markup.
                ssr:
                  locals.ssr &&
                  JSON.stringify(page) === JSON.stringify(originalPage)
                    ? locals.ssr
                    : null
              }
              if (
                req.options?.action === 'auth/view-reset-password' &&
                originalPage.props?.token
              ) {
                locals.page.props.token = originalPage.props.token
                res.set('Cache-Control', 'private, no-store')
              }
            }
            return view.call(this, name, locals, ...args)
          }
          const sse = res.sse
          if (sse)
            res.sse = function (...args) {
              const stream = sse.apply(this, args)
              const send = stream.send
              stream.send = function (value, ...rest) {
                return send.call(this, response(req, res, value), ...rest)
              }
              return stream
            }
          next()
        }
      }
    }
  }
  return hook
}
