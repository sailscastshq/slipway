// Disposable Linux-only Sails app. No customer source, scheduler or payment jobs.
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const root = '/app'
fs.mkdirSync(`${root}/node_modules`, { recursive: true })
for (const name of fs.readdirSync('/fixture/node_modules')) {
  if (name.startsWith('.')) continue
  fs.symlinkSync(
    `/fixture/node_modules/${name}`,
    `${root}/node_modules/${name}`
  )
}
fs.symlinkSync(
  '/pgdeps/node_modules/sails-postgresql',
  `${root}/node_modules/sails-postgresql`
)
for (const directory of ['config/env', 'api/models'])
  fs.mkdirSync(`${root}/${directory}`, { recursive: true })
fs.writeFileSync(
  `${root}/package.json`,
  JSON.stringify({
    private: true,
    dependencies: { sails: '*', 'sails-hook-orm': '*', 'sails-postgresql': '*' }
  })
)
fs.writeFileSync(
  `${root}/.sailsrc`,
  JSON.stringify({ log: { level: 'error' } })
)
fs.writeFileSync(
  `${root}/config/env/production.js`,
  `module.exports = {
  port: 1337, host: '0.0.0.0',
  globals: {sails:true,models:true,_:false,async:false},
  hooks: {orm:require('sails-hook-orm'),grunt:false,shipwright:false,dev:false,sockets:false,pubsub:false,quest:false},
  security: {csrf:false},
  models: {migrate:'safe',attributes:{createdAt:false,updatedAt:false}},
  datastores: {default:{adapter:'sails-postgresql',url:process.env.DATABASE_URL}},
  session: {adapter:'@sailshq/connect-redis',url:process.env.REDIS_URL,secret:process.env.SESSION_SECRET,
    prefix:process.env.FIXTURE_SESSION_PREFIX,cookie:{secure:false}},
  routes: {
    ['GET '+process.env.FIXTURE_HEALTH_PATH]: async function(req,res) {
      if (require('fs').existsSync('/tmp/unhealthy')) return res.status(503).send('fixture unhealthy');
      await Sample.count();res.send('healthy');
    },
    'GET /': async function(req,res) {
      req.session.visits=(req.session.visits||0)+1;
      const redis=require('redis').createClient(process.env.REDIS_URL);
      const queued=await new Promise((resolve,reject)=>redis.llen(process.env.QUEUE_NAMESPACE,(e,v)=>e?reject(e):resolve(v)));
      redis.quit();
      res.json({app:process.env.FIXTURE_APP,version:process.env.FIXTURE_VERSION,rows:await Sample.count(),visits:req.session.visits,queued});
    }
  }
}`
)
fs.writeFileSync(
  `${root}/api/models/Sample.js`,
  `module.exports={tableName:'sample',attributes:{id:{type:'number',columnType:'integer',autoIncrement:true},name:{type:'string',required:true}}}`
)
fs.writeFileSync(
  `${root}/app.js`,
  `
const sails=require('sails');
sails.lift(sails.getRc(),error=>{
  if(error){console.error(error.stack||error);process.exit(1)}
  if(!sails.models.sample) throw new Error('Disposable Waterline model was not loaded');
  const {registerHelmRuntime}=require('/fixture/packages/hook/lib/helm-runtime-contract');
  registerHelmRuntime({appId:process.env.SLIPWAY_APP_ID,deploymentId:process.env.SLIPWAY_DEPLOYMENT_ID,sailsApp:sails});
});
`
)
const child = spawn(process.execPath, ['app.js'], {
  cwd: root,
  env: process.env,
  stdio: 'inherit'
})
child.once('error', (error) => {
  console.error(error.message)
  process.exit(1)
})
child.once('exit', (code) => process.exit(code ?? 1))
