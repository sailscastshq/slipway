/**
 * Launch the app's installed Sails CLI in an isolated command child. Keep this
 * function self-contained: Helm serializes it into that child after adopting
 * the selected app process's environment and working directory.
 *
 * The version gate is deliberate. The integration uses whelk's per-definition
 * `sails` instance and its documented getRc() method, without replacing load,
 * lift, initialize, lower, or any shared Sails prototype. New releases must pass
 * the native-CLI contract tests before they are added here.
 */
module.exports = function launchSailsCommand({ argv, appContext = {} }) {
  const path = require('node:path')
  const crypto = require('node:crypto')
  const { createRequire } = require('node:module')
  const appRequire = createRequire(path.join(process.cwd(), 'package.json'))
  const fail = (code, message) => {
    const error = new Error(message)
    error.code = code
    throw error
  }

  if (
    !Array.isArray(argv) ||
    argv[1] !== 'run' ||
    typeof argv[2] !== 'string' ||
    !argv[2].trim() ||
    argv[2].startsWith('-') ||
    argv.some((arg) => typeof arg !== 'string')
  ) {
    fail('HELM_COMMAND_INVALID', 'Use sails run followed by a script name.')
  }

  const sailsPackagePath = appRequire.resolve('sails/package.json')
  const sailsRequire = createRequire(sailsPackagePath)
  const sailsVersion = sailsRequire('./package.json').version
  const whelkVersion = sailsRequire('whelk/package.json').version
  if (sailsVersion !== '1.5.18' || whelkVersion !== '6.0.2') {
    fail(
      'HELM_COMMAND_UNSUPPORTED_SAILS',
      'Helm Sails commands currently support Sails 1.5.18 with whelk 6.0.2. The installed CLI has not passed the command lifecycle checks.'
    )
  }

  // Sails also accepts package.json shell aliases. Those bypass its managed
  // lifecycle entirely, so they cannot provide this command's safety contract.
  // Match the supported CLI's name and file-extension normalization.
  const extensions = sailsRequire('common-js-file-extensions').code
  const extensionPattern = new RegExp(
    '^([^.]+)\\.(' + extensions.join('|') + ')$'
  )
  const scriptName = argv[2]
    .trim()
    .replace(/^scripts\//, '')
    .replace(extensionPattern, '$1')
  const appPackage = appRequire('./package.json')
  if (appPackage.scripts && appPackage.scripts[scriptName]) {
    fail(
      'HELM_COMMAND_UNSUPPORTED_SCRIPT',
      'Helm Sails commands require a Sails script module. package.json shell aliases do not expose the Sails runtime for verification.'
    )
  }

  const cliPath = sailsRequire.resolve('./bin/sails.js')
  const commandArgv = [process.execPath, cliPath, ...argv.slice(1)]
  const runtimeArgv = Array.isArray(appContext.argv)
    ? [...appContext.argv]
    : [process.execPath, path.join(process.cwd(), 'app.js')]
  process.argv = commandArgv

  // Load whelk with the real command argv: its yargs dependency captures argv
  // when required. Replace only this resolved module export, only until the CLI
  // calls it once. Other app instances and nested calls retain native behavior.
  const whelkPath = sailsRequire.resolve('whelk')
  const nativeWhelk = sailsRequire('whelk')
  const whelkModule = require.cache[whelkPath]
  whelkModule.exports = function helmWhelk(scriptDef, ...args) {
    whelkModule.exports = nativeWhelk
    // A nested whelk `def` can choose a different habitat and fn than the
    // outer Sails CLI definition. Require the ordinary flat script contract.
    if (scriptDef.def) {
      fail(
        'HELM_COMMAND_UNSUPPORTED_SCRIPT',
        'Helm requires a flat Sails script definition; nested whelk definitions cannot be verified.'
      )
    }
    const sailsApp = scriptDef.sails
    if (
      scriptDef.habitat !== 'sails' ||
      !sailsApp ||
      typeof sailsApp.getRc !== 'function'
    ) {
      fail(
        'HELM_COMMAND_UNSUPPORTED_SCRIPT',
        'Helm cannot verify scripts that disable the Sails lifecycle with sails:false or a different habitat. Use a normal Sails script module.'
      )
    }

    const nativeGetRc = sailsApp.getRc
    sailsApp.getRc = function getHelmRuntimeRc() {
      sailsApp.getRc = nativeGetRc
      // whelk has already parsed every script input at this point. Config files
      // now see the running app's argv, including its nested rc overrides. Do
      // not merge script flags into config: e.g. a script input --environment
      // must not silently select a different datastore.
      process.argv = runtimeArgv
      const rc = nativeGetRc.call(this)
      if (appContext.environment) rc.environment = appContext.environment
      const merge = sailsRequire('@sailshq/lodash').merge
      return merge({}, rc, {
        safe: true, // Also defeats Sails' --drop / --alter shortcut mapping.
        models: { migrate: 'safe' },
        quest: { autoStart: false }
      })
    }

    const originalFn = scriptDef.fn
    if (typeof originalFn === 'function') {
      const beforeScript = () => {
        process.argv = commandArgv
        if (sailsApp.config.models?.migrate !== 'safe') {
          fail(
            'HELM_COMMAND_UNSAFE_MIGRATIONS',
            'The Sails app changed Helm’s safe migration setting while loading.'
          )
        }
        if (sailsApp.config.quest?.autoStart !== false) {
          fail(
            'HELM_COMMAND_UNSAFE_QUEST',
            'The Sails app changed Helm’s disabled Quest autostart setting while loading.'
          )
        }
        if (appContext.environmentFingerprint) {
          const fingerprint = crypto
            .createHash('sha256')
            .update(
              JSON.stringify(
                Object.keys(process.env)
                  .filter((key) => key !== 'SLIPWAY_HELM_EXECUTION_ID')
                  .sort()
                  .map((key) => [key, String(process.env[key])])
              )
            )
            .digest('hex')
          if (fingerprint !== appContext.environmentFingerprint) {
            fail(
              'HELM_ENVIRONMENT_MISMATCH',
              'Helm loaded different environment settings than the running app. Check startup-time configuration before running commands.'
            )
          }
        }
        if (
          appContext.datastoreFingerprint &&
          fingerprintDatastores(sailsApp) !== appContext.datastoreFingerprint
        ) {
          fail(
            'HELM_DATASTORE_MISMATCH',
            'Helm loaded different datastore settings than the running app. Check startup-time configuration and redeploy before running commands.'
          )
        }
      }
      const guardedFn =
        originalFn.constructor.name === 'AsyncFunction'
          ? async function () {
              beforeScript()
              return originalFn.apply(this, arguments)
            }
          : function () {
              beforeScript()
              return originalFn.apply(this, arguments)
            }
      // machine distinguishes `(inputs, exits)` from classical return-value
      // scripts by inspecting the function signature. Preserve that native
      // inference, as well as async/synchronous implementation behavior.
      Object.defineProperty(guardedFn, 'toString', {
        value: () => originalFn.toString()
      })
      scriptDef.fn = guardedFn
    }
    return nativeWhelk(scriptDef, ...args)
  }

  // The installed command owns lookup, CLI inputs, validation, load, result and
  // exit handling, and lower(). In particular, do not invoke scriptDef.fn here.
  try {
    return require(cliPath)
  } finally {
    whelkModule.exports = nativeWhelk
  }

  // Same version-1 datastore shape as Helm's runtime contract. Keep it local so
  // the launcher can be serialized without requiring Slipway inside the app.
  function fingerprintDatastores(sailsApp) {
    const seen = new WeakSet()
    function canonical(value) {
      if (value === undefined) return ['undefined']
      if (
        value === null ||
        ['string', 'number', 'boolean'].includes(typeof value)
      )
        return value
      if (typeof value === 'function') return ['function']
      if (Array.isArray(value)) return value.map(canonical)
      if (typeof value !== 'object' || seen.has(value))
        throw new Error('Unsupported datastore configuration shape')
      seen.add(value)
      const result = Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, canonical(value[key])])
      )
      seen.delete(value)
      return result
    }
    const config = sailsApp.config || {}
    const shape = canonical({
      environment: config.environment,
      datastores: config.datastores,
      models: {
        datastore: config.models?.datastore,
        connection: config.models?.connection
      }
    })
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(shape))
      .digest('hex')
  }
}
