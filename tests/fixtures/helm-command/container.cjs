// Disposable Docker contract app. This fixture has no database or business jobs.
const fs = require('node:fs')
const { createRequire } = require('node:module')
const root = '/app'
fs.mkdirSync(`${root}/scripts`, { recursive: true })
fs.symlinkSync('/deps', `${root}/node_modules`)
fs.writeFileSync(
  `${root}/package.json`,
  JSON.stringify({ dependencies: { sails: '*', 'sails-hook-quest': '*' } })
)
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
fs.writeFileSync(
  `${root}/app.js`,
  `const fs=require('fs');const sails=require('sails');const {registerHelmRuntime}=require('/host/packages/hook/lib/helm-runtime-contract');sails.load(sails.getRc(),(error)=>{if(error)throw error;registerHelmRuntime({appId:process.env.SLIPWAY_APP_ID,deploymentId:process.env.SLIPWAY_DEPLOYMENT_ID,sailsApp:sails});fs.writeFileSync('/tmp/helm-command-ready','ready');setInterval(()=>{},1000)});`
)
// Re-exec a normal app entrypoint so the runtime contract records app argv.
const child = require('node:child_process').spawn(
  process.execPath,
  ['app.js'],
  { cwd: root, stdio: 'inherit', env: process.env }
)
child.on('exit', (code) => process.exit(code || 0))
