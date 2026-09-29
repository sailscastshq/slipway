/**
 * Runs inside the selected container. Keep this function self-contained: the
 * runner embeds it so older deployed hooks retain the fail-closed fallback.
 */
module.exports = function resolveHelmAppContext({
  fs = require('node:fs'),
  procRoot = '/proc',
  ownPid = process.pid,
  expectedRuntime,
  contractDir = '/tmp/slipway-helm-runtimes'
} = {}) {
  const path = require('node:path')
  const unavailable = (message) => {
    const error = new Error(message)
    error.code = 'HELM_APP_CONTEXT_UNAVAILABLE'
    return error
  }
  const readEnvironment = (pid) =>
    Object.fromEntries(
      fs
        .readFileSync(`${procRoot}/${pid}/environ`, 'utf8')
        .split('\0')
        .filter((entry) => entry.includes('='))
        .map((entry) => {
          const index = entry.indexOf('=')
          return [entry.slice(0, index), entry.slice(index + 1)]
        })
    )

  if (expectedRuntime) {
    const appId = String(expectedRuntime.appId || '')
    const deploymentId = String(expectedRuntime.deploymentId || '')
    if (!/^\d+$/.test(appId) || !/^\d+$/.test(deploymentId))
      throw unavailable(
        'Helm has no verified deployment target. Refresh the page and try again.'
      )
    const directory = contractDir
    let files
    try {
      files = fs.readdirSync(directory)
    } catch (error) {
      if (error.code !== 'ENOENT')
        throw unavailable(
          'Helm cannot read the app runtime contract in this container.'
        )
      files = []
    }
    const matching = files.filter(
      (name) =>
        name.startsWith(`${appId}-${deploymentId}-`) &&
        /^\d+-\d+-\d+\.json$/.test(name)
    )
    if (matching.length > 0) {
      const contexts = []
      for (const name of matching) {
        try {
          const filename = path.join(directory, name)
          const fileStat = fs.lstatSync(filename)
          if (!fileStat.isFile() || fileStat.size > 128 * 1024) continue
          const contract = JSON.parse(fs.readFileSync(filename, 'utf8'))
          const pid = Number(contract.pid)
          if (
            contract.version !== 1 ||
            contract.appId !== appId ||
            contract.deploymentId !== deploymentId ||
            !Number.isSafeInteger(pid) ||
            pid < 1 ||
            pid === ownPid ||
            name !== `${appId}-${deploymentId}-${pid}.json` ||
            contract.environmentSource !== 'process-start' ||
            !/^[0-9a-f]{64}$/.test(contract.environmentFingerprint || '') ||
            !/^[0-9a-f]{64}$/.test(contract.datastoreFingerprint || '') ||
            !Number.isSafeInteger(contract.argvStartIndex) ||
            contract.argvStartIndex < 1
          )
            continue
          const stat = fs.readFileSync(`${procRoot}/${pid}/stat`, 'utf8')
          const fields = stat
            .slice(stat.lastIndexOf(')') + 1)
            .trim()
            .split(/\s+/)
          if (fields[19] !== contract.startTicks) continue
          const cwd = fs.readlinkSync(`${procRoot}/${pid}/cwd`)
          const executable = fs.readlinkSync(`${procRoot}/${pid}/exe`)
          if (cwd !== contract.appPath || executable !== contract.executable)
            continue
          const commandLine = fs
            .readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8')
            .split('\0')
            .filter(Boolean)
          if (commandLine.length <= contract.argvStartIndex) continue
          const argv = [
            executable,
            ...commandLine.slice(contract.argvStartIndex)
          ]
          const env = readEnvironment(pid)
          if (
            (env.SLIPWAY_APP_ID || env.SLIPWAY_TELEMETRY_APP_ID) !== appId ||
            (env.SLIPWAY_DEPLOYMENT_ID ||
              env.SLIPWAY_TELEMETRY_DEPLOYMENT_ID) !== deploymentId ||
            env.SLIPWAY_HELM_EXECUTION_ID
          )
            continue
          contexts.push({
            pid,
            appPath: cwd,
            env,
            argv,
            environmentFingerprint: contract.environmentFingerprint,
            datastoreFingerprint: contract.datastoreFingerprint,
            completionMetadata: contract.completionMetadata || null
          })
        } catch (error) {
          if (
            ![
              'ENOENT',
              'ESRCH',
              'EACCES',
              'EPERM',
              'ENOTDIR',
              'SyntaxError'
            ].includes(error.code || error.name)
          )
            throw error
        }
      }
      if (contexts.length !== 1)
        throw unavailable(
          contexts.length
            ? 'Helm found multiple verified runtimes for this app. Run one app process per container.'
            : 'The app runtime contract no longer matches the selected process. Restart or redeploy the app, then try again.'
        )
      const { pid, ...context } = contexts[0]
      return context
    }
    // Older deployed hooks have no contract yet. Preserve the existing
    // fail-closed discovery during their migration, never a guessed config.
    if (files.some((name) => name.startsWith(`${appId}-`)))
      throw unavailable(
        'Helm found a contract for another deployment. Wait for the current app to start or redeploy it.'
      )
    if (expectedRuntime.required)
      throw unavailable(
        'The running app has not published its Helm runtime contract. Restart or redeploy the app, then try again.'
      )
  }

  const candidates = []
  for (const pid of fs.readdirSync(procRoot).filter((id) => /^\d+$/.test(id))) {
    if (Number(pid) === ownPid) continue
    try {
      const argv = fs
        .readFileSync(`${procRoot}/${pid}/cmdline`, 'utf8')
        .split('\0')
        .filter(Boolean)
      if (!/^node(?:js)?$/.test(path.basename(argv[0] || ''))) continue
      // Only accept an ordinary Node script/CLI entrypoint. Preloads and env
      // files can mutate configuration after exec, which /proc cannot observe.
      let scriptIndex = 1
      while (argv[scriptIndex]?.startsWith('-')) {
        if (
          /^(?:--(?:inspect(?:-brk)?|max-old-space-size|stack-size)(?:=|$)|--(?:no-warnings|enable-source-maps)$)/.test(
            argv[scriptIndex]
          )
        ) {
          if (
            ['--max-old-space-size', '--stack-size'].includes(argv[scriptIndex])
          )
            scriptIndex += 1
          scriptIndex += 1
          continue
        }
        scriptIndex = -1
        break
      }
      if (scriptIndex < 0 || !argv[scriptIndex]) continue
      const script = argv[scriptIndex]
      if (/(?:npm-cli|npx-cli|yarn|pnpm)\.(?:c?js)$/.test(script)) continue
      const cwd = fs.readlinkSync(`${procRoot}/${pid}/cwd`)
      const relativeScript = path.relative(cwd, path.resolve(cwd, script))
      const isSailsCli = /(?:^|[/\\])sails(?:\.js)?$/.test(script)
      // A standalone Quest/Sails job is not the app server, even when it is
      // the only Sails process visible during a restart.
      if (isSailsCli && argv[scriptIndex + 1] === 'run') continue
      if (
        !isSailsCli &&
        (relativeScript.startsWith('..') ||
          relativeScript.split(path.sep).includes('node_modules'))
      )
        continue
      const pkg = JSON.parse(
        fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')
      )
      if (!pkg.dependencies?.sails && !pkg.devDependencies?.sails) continue
      const env = readEnvironment(pid)
      if (env.SLIPWAY_HELM_EXECUTION_ID) continue
      if (
        expectedRuntime &&
        ((env.SLIPWAY_TELEMETRY_APP_ID &&
          env.SLIPWAY_TELEMETRY_APP_ID !== String(expectedRuntime.appId)) ||
          (env.SLIPWAY_APP_ID &&
            env.SLIPWAY_APP_ID !== String(expectedRuntime.appId)) ||
          (env.SLIPWAY_TELEMETRY_DEPLOYMENT_ID &&
            env.SLIPWAY_TELEMETRY_DEPLOYMENT_ID !==
              String(expectedRuntime.deploymentId)) ||
          (env.SLIPWAY_DEPLOYMENT_ID &&
            env.SLIPWAY_DEPLOYMENT_ID !== String(expectedRuntime.deploymentId)))
      )
        continue
      candidates.push({
        pid: Number(pid),
        appPath: cwd,
        env,
        argv: [argv[0], script, ...argv.slice(scriptIndex + 1)]
      })
    } catch (error) {
      // Processes can exit while /proc is read. Never print their environment.
      if (
        !['ENOENT', 'ESRCH', 'EACCES', 'EPERM', 'ENOTDIR'].includes(error.code)
      )
        throw error
    }
  }
  const candidatePids = new Set(candidates.map(({ pid }) => pid))
  let roots
  try {
    roots = candidates.filter(({ pid }) => {
      const seen = new Set([pid])
      let current = pid
      while (current > 1) {
        // /proc stat wraps the command in parentheses; the command itself can
        // contain spaces or ')' so split only after its final closing bracket.
        const stat = fs.readFileSync(`${procRoot}/${current}/stat`, 'utf8')
        const fields = stat
          .slice(stat.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/)
        const parent = Number(fields[1])
        if (!Number.isInteger(parent) || parent < 1 || seen.has(parent)) {
          throw new Error('Invalid process ancestry')
        }
        if (candidatePids.has(parent)) return false
        seen.add(parent)
        current = parent
      }
      return true
    })
  } catch {
    const error = new Error(
      'Helm could not verify the running app process tree. Try again after the app settles.'
    )
    error.code = 'HELM_APP_CONTEXT_UNAVAILABLE'
    throw error
  }
  if (roots.length !== 1) {
    const error = new Error(
      roots.length
        ? 'Helm found multiple app runtimes in this container. Update sails-hook-slipway to 0.0.11 and redeploy so the app can identify its runtime.'
        : 'Helm could not identify the running Sails app. Update sails-hook-slipway to 0.0.11 and redeploy, or use a standard Node entrypoint with container-level environment variables.'
    )
    error.code = 'HELM_APP_CONTEXT_UNAVAILABLE'
    throw error
  }
  const { pid, ...context } = roots[0]
  return context
}
