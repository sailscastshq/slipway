// Disposable Docker contract app. This fixture has no database or business jobs.
const fs = require('node:fs')
const { createRequire } = require('node:module')
const root = '/app'
const dependencies = '/fixture/node_modules'
// CI installs npm workspaces as relative symlinks. A relocated dependency mount
// needs matching sibling packages/assets mounts before Sails scans it. Keeping
// the real dependency directory named node_modules also preserves hoisted
// transitive resolution from /fixture/node_modules/sails/lib/app/index.js.
for (const entry of fs.readdirSync(dependencies)) {
  if (entry.startsWith('.')) continue
  const paths = entry.startsWith('@')
    ? fs
        .readdirSync(`${dependencies}/${entry}`)
        .map((name) => `${dependencies}/${entry}/${name}`)
    : [`${dependencies}/${entry}`]
  for (const dependency of paths) {
    if (!fs.lstatSync(dependency).isSymbolicLink()) continue
    try {
      fs.realpathSync(dependency)
    } catch (error) {
      throw new Error(
        `Fixture dependency link is unresolved: ${dependency} -> ${fs.readlinkSync(
          dependency
        )}`,
        { cause: error }
      )
    }
  }
}
fs.mkdirSync(`${root}/scripts`, { recursive: true })
fs.symlinkSync(dependencies, `${root}/node_modules`)
fs.writeFileSync(
  `${root}/package.json`,
  JSON.stringify({
    scripts: {},
    dependencies: { sails: '*', 'sails-hook-quest': '*' }
  })
)
// Fail with the actual missing dependency before opaque Sails startup errors.
// Resolve from each installed package's real location, using normal Node rules.
// This checks the mounted layout without NODE_PATH or executing any app jobs.
const appRequire = createRequire(`${root}/package.json`)
for (const name of ['sails', 'sails-hook-quest']) {
  const packagePath = appRequire.resolve(`${name}/package.json`)
  const packageRequire = createRequire(packagePath)
  for (const dependency of Object.keys(
    packageRequire('./package.json').dependencies || {}
  )) {
    packageRequire.resolve(dependency)
  }
}
console.log('[Helm fixture] Installed dependency resolution verified')

fs.writeFileSync(
  `${root}/.sailsrc`,
  JSON.stringify({
    loadHooks: ['moduleloader', 'userconfig', 'userhooks', 'quest'],
    models: { migrate: 'safe' },
    quest: { autoStart: false },
    log: { level: 'silent' }
  })
)
fs.writeFileSync(
  `${root}/scripts/probe.js`,
  `module.exports = {
  friendlyName:'Disposable probe', inputs:{handle:{type:'string',required:true}},
  fn:async function(inputs){
    console.log(JSON.stringify({handle:inputs.handle,environment:this.sails.config.environment,cwd:process.cwd(),migrate:this.sails.config.models.migrate,autoStart:this.sails.config.quest.autoStart}));
    console.error('fixture-stderr');
  }
}`
)
fs.writeFileSync(`${root}/app.js`, `(${runFixtureApp.toString()})()`)

function runFixtureApp() {
  const fs = require('node:fs')
  const sails = require('sails')
  const {
    registerHelmRuntime
  } = require('/fixture/packages/hook/lib/helm-runtime-contract')
  sails.load(sails.getRc(), (error) => {
    if (error) {
      console.error(
        '[Helm fixture] Sails failed to load:',
        error.stack || error
      )
      process.exit(1)
    }
    const unregister = registerHelmRuntime({
      appId: process.env.SLIPWAY_APP_ID,
      deploymentId: process.env.SLIPWAY_DEPLOYMENT_ID,
      sailsApp: sails
    })
    if (typeof unregister !== 'function') {
      throw new Error(
        'The disposable app did not publish its runtime contract.'
      )
    }
    fs.writeFileSync('/tmp/helm-command-ready', 'ready')
    console.log('[Helm fixture] Verified runtime contract published')
    setInterval(() => {}, 1000)
  })
}
// Re-exec a normal app entrypoint so the runtime contract records app argv.
const child = require('node:child_process').spawn(
  process.execPath,
  ['app.js'],
  { cwd: root, stdio: 'inherit', env: process.env }
)
child.once('error', (error) => {
  console.error('[Helm fixture] App spawn failed:', error.message)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  console.error(`[Helm fixture] App exited with code ${code}, signal ${signal}`)
  process.exit(code ?? 1)
})
