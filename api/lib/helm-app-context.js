/**
 * Runs inside the selected container. Keep this function self-contained: the
 * runner embeds it so deployed apps do not need a new Slipway hook version.
 */
module.exports = function resolveHelmAppContext({
  fs = require('node:fs'),
  procRoot = '/proc',
  ownPid = process.pid
} = {}) {
  const path = require('node:path')
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
      const env = Object.fromEntries(
        fs
          .readFileSync(`${procRoot}/${pid}/environ`, 'utf8')
          .split('\0')
          .filter((entry) => entry.includes('='))
          .map((entry) => {
            const index = entry.indexOf('=')
            return [entry.slice(0, index), entry.slice(index + 1)]
          })
      )
      if (env.SLIPWAY_HELM_EXECUTION_ID) continue
      candidates.push({
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
  const contexts = new Map(
    candidates.map((candidate) => [
      JSON.stringify({
        appPath: candidate.appPath,
        env: Object.fromEntries(
          Object.entries(candidate.env).sort(([a], [b]) => a.localeCompare(b))
        ),
        argv: candidate.argv
      }),
      candidate
    ])
  )
  if (contexts.size !== 1) {
    const error = new Error(
      contexts.size
        ? 'Helm found multiple app runtimes in this container. It cannot safely choose a database.'
        : 'Helm could not identify the running Sails app. Ensure it is running with a standard Node entrypoint and container-level environment variables.'
    )
    error.code = 'HELM_APP_CONTEXT_UNAVAILABLE'
    throw error
  }
  return contexts.values().next().value
}
