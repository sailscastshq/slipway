const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const crypto = require('node:crypto')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')

assert.equal(process.env.CI, 'true')
assert.equal(process.platform, 'linux')
const root = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP, 'registry-pair-'))
const app = path.join(root, 'app')
fs.mkdirSync(app)
fs.mkdirSync(path.join(app, 'scripts'))
const expected = {
  'sails-hook-quest': ['0.0.6', 'sha512-duF3LfQWY2q3oKR07l8gVcCNRMycS4xVvFaTF2Tm4mUkl7s48CfbyYRjlk4VBouGJoFcYZ4IvlSc4XtldDRLLg=='],
  'sails-hook-slipway': ['0.0.12', 'sha512-WHNetxrI4DttKoYP3kM4CE8j5KP3Eo9NoItgpOXT1cZQ2hPwkTIplC+8IdIljuYMC7LwV4V2M3oSNu8DSMANOw=='],
  'slipway-cli': ['0.0.3', 'sha512-SHnmZJ8qGPlftqNlHVUlqOCWew/2uBM4CyzdMs8Tv0tzl3Jr5fd4cMShYjpKPJep0yH8dKqT8PU0RUyj2rposA==']
}
fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({private:true,scripts:{},dependencies:{sails:'1.5.18','sails-hook-orm':'4.0.3',...Object.fromEntries(Object.entries(expected).map(([name,[version]])=>[name,version]))}}))
execFileSync('npm', ['install','--ignore-scripts','--no-audit','--no-fund'], {cwd:app,stdio:'inherit',timeout:180000})
const lock = JSON.parse(fs.readFileSync(path.join(app, 'package-lock.json')))
const packageProof = {}
for (const [name,[version,integrity]] of Object.entries(expected)) {
  const entry = lock.packages[`node_modules/${name}`]
  assert.equal(entry.version, version)
  assert.equal(entry.integrity, integrity)
  assert.ok(entry.resolved.startsWith('https://registry.npmjs.org/'))
  assert.equal(fs.lstatSync(path.join(app,'node_modules',name)).isSymbolicLink(),false)
  packageProof[name]={version,integrity,resolved:entry.resolved}
}
fs.writeFileSync(path.join(app,'.sailsrc'),JSON.stringify({loadHooks:['moduleloader','userconfig','userhooks','helpers','orm','quest','slipway'],models:{migrate:'safe'},log:{level:'error',noShip:true}}))
fs.writeFileSync(path.join(app,'scripts','registry-report.js'), `module.exports={inputs:{count:{type:'number',defaultsTo:7},enabled:{type:'boolean',defaultsTo:true},label:{type:'string',allowNull:true}},fn:async function(inputs){console.log('registry fixture log');return inputs}}`)
process.env.SLIPWAY_APP_ID='98187'
process.env.SLIPWAY_DEPLOYMENT_ID='98187'
process.chdir(app)
const req=createRequire(path.join(app,'package.json'))
const sails=req('sails')
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function wait(read,accept){const until=Date.now()+30000;while(Date.now()<until){try{const value=await read();if(accept(value))return value}catch{}await delay(50)}throw Error('Registry resident proof timed out')}
let identity
function request(message){return new Promise((resolve,reject)=>{const socket=net.createConnection(identity.socket);let body='';socket.setTimeout(5000,()=>socket.destroy(Error('UDS timeout')));socket.on('error',reject);socket.on('connect',()=>socket.write(JSON.stringify({appId:identity.appId,deploymentId:identity.deploymentId,runtimeId:identity.runtimeId,...message})+'\n'));socket.on('data',chunk=>body+=chunk);socket.on('end',()=>{try{const result=JSON.parse(body);if(!result.ok)throw Object.assign(Error(result.error.message),result.error);resolve(result.data)}catch(e){reject(e)}})})}
async function main(){
  const timer=setTimeout(()=>{console.error('Bounded registry proof exceeded 120 seconds');process.exit(1)},120000)
  await new Promise((resolve,reject)=>sails.lift({...sails.getRc(),appPath:app,quest:{autoStart:false,jobs:['registry-report']},slipway:{quest:{enabled:true},lookout:{enabled:false},flags:{enabled:false},wake:{enabled:false},bearing:{enabled:false},bridge:{enabled:false}}},error=>error?reject(error):resolve()))
  try {
    assert.ok(sails.hooks.orm)
    const runtime=sails.quest.getRuntime()
    for(const key of ['residentState','runIdentity','inputMetadata','businessResults','childSchedulerSuppression','triggerProvenance','terminalExitCode','terminalSignal','scheduleDiagnostics'])assert.equal(runtime.capabilities[key],true)
    const registration=`/tmp/slipway-quest-runtimes/98187-98187-${process.pid}.json`
    identity=await wait(()=>JSON.parse(fs.readFileSync(registration)),value=>value.runtimeId===runtime.runtimeId)
    const snapshot=await request({command:'snapshot'})
    for(const key of ['invoke','typedInputs','results','pause','resume'])assert.equal(snapshot.capabilities[key],true)
    assert.equal(snapshot.capabilities.cancel,false)
    const job=snapshot.jobs.find(job=>job.name==='registry-report')
    assert.equal(job.inputMetadataAvailable,true)
    assert.equal((await request({command:'pause',name:job.name})).job.paused,true)
    assert.equal((await request({command:'resume',name:job.name})).job.paused,false)
    const command={command:'invoke',name:job.name,metadataVersion:job.metadataVersion,requestId:crypto.randomUUID(),jobInputs:{count:0,enabled:false,label:null}}
    const admitted=await request(command)
    const receipt=await wait(()=>request({command:'run',runId:admitted.run.runId}),data=>data.run.state==='completed')
    assert.equal(receipt.run.exitCode,0)
    assert.equal(receipt.run.result.status,'available')
    assert.deepEqual(receipt.run.result.value,{count:0,enabled:false,label:null})
    assert.match(receipt.run.stdout,/registry fixture log/)
    assert.equal((await request(command)).run.runId,admitted.run.runId)
    assert.equal((await request({command:'snapshot'})).runs.length,1)
    const cli=path.join(app,'node_modules/.bin/slipway')
    assert.equal(execFileSync(cli,['--version'],{encoding:'utf8'}).trim(),'slipway v0.0.3')
    let error;try{execFileSync(cli,['unknown-registry-command','--json'],{encoding:'utf8'})}catch(e){error=e}
    assert.equal(error.status,1);assert.equal(error.stdout,'');assert.equal(JSON.parse(error.stderr).error.code,'CLI_UNKNOWN_COMMAND')
    const output=path.join(process.env.GITHUB_WORKSPACE,'.tmp/release-registry-proof');fs.mkdirSync(output,{recursive:true})
    fs.copyFileSync(path.join(app,'package-lock.json'),path.join(output,'consumer-lock.json'))
    fs.writeFileSync(path.join(output,'proof.json'),JSON.stringify({mode:'registry-installed-consumer',releaseSha:process.env.RELEASE_SHA,packages:packageProof,runtimeCapabilities:runtime.capabilities,controls:snapshot.capabilities,orm:true,realUds:true,typedFalsiesAndResult:true,logsSeparated:true,requestDeduplication:true,registryCli:true,runId:admitted.run.runId},null,2)+'\n')
  } finally {await new Promise((resolve,reject)=>sails.lower(error=>error?reject(error):resolve()));clearTimeout(timer)}
}
main().catch(error=>{console.error(error.stack);process.exit(1)})
