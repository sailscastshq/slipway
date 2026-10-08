// Actual Docker proof, isolated to labelled fixture containers and volumes.
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const image = process.env.SLIPWAY_RECOVERY_IMAGE
if (!image) throw new Error('Set SLIPWAY_RECOVERY_IMAGE to the candidate image')
const repo = path.resolve(__dirname, '../..')
const work = fs.mkdtempSync(path.join(repo, '.tmp/system-recovery-proof-'))
const tag = 'system-recovery-' + crypto.randomUUID().slice(0, 8)
const docker = (args, options = {}) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 600000,
    ...options
  })
const ownedContainers = []
const ownedVolumes = []
const owner = ['--label', `slipway.test.owner=${tag}`]
function seedCode(fail) {
  return `const fs=require('fs'),D=require('better-sqlite3'),{execFileSync}=require('child_process');
const legacy=require('/proof/legacy-production-ddl.json'),files=require('/app/api/lib/release-migrations').files;
for(const [name,ddl]of Object.entries(legacy.datastores)){const d=new D('/app/db/'+files[name]);for(const sql of ddl)d.exec(sql);d.exec("CREATE TABLE fixture_records(id INTEGER PRIMARY KEY, payload TEXT); INSERT INTO fixture_records VALUES(1,'must preserve')");d.close()}
const tool='/proof/sqlite3-recovery',app='/app/db/app.db';execFileSync(tool,[app,'ANALYZE']);const page=Number(execFileSync(tool,[app,"SELECT rootpage FROM sqlite_schema WHERE name='sqlite_stat4'"],{encoding:'utf8'}));const size=Number(execFileSync(tool,[app,'PRAGMA page_size'],{encoding:'utf8'}));if(!page)throw Error('missing planner stats');const f=fs.openSync(app,'r+');fs.writeSync(f,Buffer.from([0]),0,1,(page-1)*size);fs.closeSync(f);
fs.writeFileSync('/proof/original-${fail}.json',JSON.stringify(Object.values(files).map(file=>({file,hash:require('crypto').createHash('sha256').update(fs.readFileSync('/app/db/'+file)).digest('hex')}))));`
}
try {
  fs.copyFileSync(
    path.join(repo, 'tests/prelift/fixtures/legacy-production-ddl.json'),
    path.join(work, 'legacy-production-ddl.json')
  )
  // Compile the checksum-verified test-only amalgamation, never a runtime dependency.
  const source = process.env.SQLITE_RECOVERY_SOURCE
  if (!source)
    throw new Error(
      'Set SQLITE_RECOVERY_SOURCE to verified amalgamation sources'
    )
  fs.cpSync(source, path.join(work, 'sqlite-source'), { recursive: true })
  docker([
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${work}:/proof`,
    image,
    'sh',
    '-c',
    'cc -O1 -DSQLITE_ENABLE_DBPAGE_VTAB -DSQLITE_ENABLE_STAT4 /proof/sqlite-source/shell.c /proof/sqlite-source/sqlite3.c -ldl -lm -lpthread -o /proof/sqlite3-recovery'
  ])
  fs.writeFileSync(
    path.join(work, 'server.cjs'),
    `const fs=require('fs'),D=require('/app/node_modules/better-sqlite3'),http=require('http');const marker='/app/db/fixture-boot';const repeat=fs.existsSync(marker);fs.writeFileSync(marker,'booted');http.createServer((req,res)=>{let d;try{d=new D('/app/db/app.db',{readonly:true});if(fs.existsSync('/app/db/.slipway-recovery-in-progress'))throw Error('interrupted recovery');if(process.env.FAIL_RESTART==='1'&&repeat)throw Error('failed restart');if(d.pragma('integrity_check',{simple:true})!=='ok')throw Error('corrupt');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok'}))}catch{res.statusCode=503;res.end('unhealthy')}finally{d?.close()}}).listen(1337,'0.0.0.0');`
  )
  // Host-side fuser is needed by the operator flow. Fixture image only.
  const helperImage = `${image}-recovery-proof`
  fs.writeFileSync(
    path.join(work, 'Dockerfile'),
    `FROM ${image}\nRUN apt-get update && apt-get install -y --no-install-recommends psmisc && rm -rf /var/lib/apt/lists/*\n`
  )
  docker(['build', '-t', helperImage, work], { stdio: 'inherit' })
  for (const method of ['native', 'logical'])
    for (const fail of [false, true]) {
      const identity = `${method}-${fail}`
      const container = `${tag}-slipway-${identity}`
      const volume = `${tag}-${identity}`
      docker([
        'volume',
        'create',
        '--label',
        `slipway.test.owner=${tag}`,
        volume
      ])
      ownedVolumes.push(volume)
      const live = JSON.parse(docker(['volume', 'inspect', volume]))[0]
        .Mountpoint
      docker([
        'run',
        '--rm',
        '--network',
        'none',
        '-v',
        `${volume}:/app/db`,
        '-v',
        `${work}:/proof`,
        image,
        'node',
        '-e',
        seedCode(identity)
      ])
      docker([
        'run',
        '-d',
        ...owner,
        '--name',
        container,
        '--network',
        'none',
        '-e',
        `FAIL_RESTART=${fail ? '1' : '0'}`,
        '-v',
        `${volume}:/app/db`,
        '-v',
        `${work}:/proof:ro`,
        image,
        'node',
        '/proof/server.cjs'
      ])
      ownedContainers.push(container)
      // Shares only fixture data and source paths. Never mounts the host root.
      const operator = `${tag}-operator`
      ownedContainers.push(operator)
      let failed = false
      try {
        docker(
          [
            'run',
            '--rm',
            ...owner,
            '--name',
            operator,
            '--pid',
            'host',
            '--cap-add',
            'SYS_PTRACE',
            '-e',
            `SLIPWAY_RECOVERY_CONTAINER=${container}`,
            '-e',
            `SLIPWAY_RECOVERY_ROOT=${work}`,
            '-e',
            'SLIPWAY_RECOVERY_HEALTH_ATTEMPTS=3',
            '-v',
            '/var/run/docker.sock:/var/run/docker.sock',
            '-v',
            `${volume}:${live}`,
            '-v',
            `${repo}:${repo}:ro`,
            '-v',
            `${work}:${work}`,
            helperImage,
            'bash',
            `${repo}/bin/recover-slipway.sh`,
            image,
            method === 'logical' ? '--logical-app' : `${work}/sqlite3-recovery`,
            '--reset-observability'
          ],
          { stdio: 'inherit' }
        )
      } catch {
        failed = true
      }
      assert.equal(failed, fail)
      const original = JSON.parse(
        fs.readFileSync(path.join(work, `original-${identity}.json`))
      )
      const proof = JSON.parse(
        docker([
          'run',
          '--rm',
          '--network',
          'none',
          '-v',
          `${volume}:/app/db:ro`,
          image,
          'node',
          '-e',
          `const fs=require('fs'),D=require('better-sqlite3'),c=require('crypto');const d=new D('/app/db/app.db',{readonly:true});let integrity;try{integrity=d.pragma('integrity_check',{simple:true})}catch{integrity='corrupt'}console.log(JSON.stringify({integrity,rows:d.prepare('SELECT * FROM fixture_records').all(),marker:fs.existsSync('/app/db/.slipway-recovery-in-progress'),hashes:${JSON.stringify(
            original.map((item) => item.file)
          )}.map(file=>({file,hash:c.createHash('sha256').update(fs.readFileSync('/app/db/'+file)).digest('hex')}))}));d.close()`
        ])
      )
      assert.equal(proof.marker, false)
      if (fail) assert.deepEqual(proof.hashes, original)
      else {
        assert.equal(proof.integrity, 'ok')
        assert.deepEqual(proof.rows, [{ id: 1, payload: 'must preserve' }])
        const count = docker([
          'exec',
          container,
          'node',
          '-e',
          "const D=require('better-sqlite3'),d=new D('/app/db/observability.db');console.log(d.prepare('SELECT count(*) count FROM fixture_records').get().count);d.close()"
        ])
        assert.equal(count.trim(), '0')
      }
      console.log(
        JSON.stringify({
          method,
          fixture: fail
            ? 'failed restart rollback'
            : 'successful recovery and observability reset',
          passed: true
        })
      )
      assert.equal(
        JSON.parse(docker(['inspect', container]))[0].Config.Labels[
          'slipway.test.owner'
        ],
        tag
      )
      docker(['rm', '-f', container])
      ownedContainers.splice(ownedContainers.indexOf(container), 1)
    }
} finally {
  for (const name of ownedContainers) {
    try {
      const item = JSON.parse(docker(['inspect', name]))[0]
      if (item.Config.Labels?.['slipway.test.owner'] === tag)
        docker(['rm', '-f', name])
    } catch {}
  }
  for (const name of ownedVolumes) {
    try {
      docker(['volume', 'rm', name])
    } catch {}
  }
  fs.rmSync(work, { recursive: true, force: true })
}
