const { test } = require('sounding')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const run = require('node:util').promisify(
  require('node:child_process').execFile
)
test('every registered command and alias exposes its own help without authentication or prompts', async () => {
  const cli = path.resolve('packages/cli/src/index.js')
  const { commands, aliases } = await import(
    pathToFileURL(path.resolve('packages/cli/src/lib/commands.js'))
  )
  for (const [requested, command] of [
    ...Object.keys(commands).map((name) => [name, name]),
    ...Object.entries(aliases)
  ]) {
    const { stdout, stderr } = await run(
      process.execPath,
      [cli, requested, '--help'],
      { timeout: 5000 }
    )
    assert.equal(stderr, '', requested)
    assert.ok(stdout.includes(commands[command].description), requested)
    assert.ok(!stdout.includes('Usage: slipway <command>'), requested)
    for (const flag of Object.keys(commands[command].options))
      assert.ok(stdout.includes(`--${flag}`), `${requested}: ${flag}`)
  }
  for (const args of [[], ['--help'], ['-h']]) {
    const { stdout } = await run(process.execPath, [cli, ...args], {
      timeout: 5000
    })
    assert.ok(stdout.includes('Usage: slipway <command>'))
    assert.ok(stdout.includes('doctor'))
  }
  const version = await run(process.execPath, [cli, '--version'])
  assert.match(version.stdout, /^slipway v\d/)
  for (const args of [
    ['unknown-command', '--json'],
    ['unknown-command', '--help', '--json'],
    ['logs', '--bad-flag', '--json'],
    ['--unknown', '--json']
  ]) {
    await assert.rejects(
      run(process.execPath, [cli, ...args], { timeout: 5000 }),
      (error) => {
        assert.equal(error.code, 1)
        assert.equal(error.stdout, '')
        const data = JSON.parse(error.stderr)
        assert.equal(data.type, 'error')
        assert.ok(data.error.code)
        return true
      }
    )
  }
})

test('command-owned version reaches database creation while root version remains global', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-version-cli-'))
  const cli = path.resolve('packages/cli/src/index.js')
  try {
    fs.mkdirSync(path.join(root, '.slipway'))
    fs.writeFileSync(
      path.join(root, '.slipway/config.json'),
      JSON.stringify({ token: 'fixture', server: 'https://fixture.invalid' })
    )
    fs.writeFileSync(
      path.join(root, '.slipway.json'),
      JSON.stringify({ project: 'example' })
    )
    const runner = path.join(root, 'runner.mjs')
    fs.writeFileSync(
      runner,
      `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; import assert from 'node:assert/strict'; os.homedir=()=>${JSON.stringify(
        root
      )}; syncBuiltinESMExports(); process.chdir(${JSON.stringify(
        root
      )}); process.argv=['node',${JSON.stringify(
        cli
      )},'db:create','fixture-db','--version','17','--env','staging']; let calls=0; globalThis.fetch=async(url,options)=>{calls++; assert.equal(url,'https://fixture.invalid/api/v1/projects/example/environments/staging/services'); assert.equal(options.method,'POST'); assert.deepEqual(JSON.parse(options.body),{name:'fixture-db',type:'postgresql',version:'17'}); return new Response(JSON.stringify({service:{name:'fixture-db',type:'postgresql',version:'17'}}));}; await import(${JSON.stringify(
        cli
      )}); process.on('beforeExit',()=>assert.equal(calls,1));`
    )
    const { stdout, stderr } = await run(process.execPath, [runner], {
      timeout: 5000
    })
    assert.equal(stderr, '')
    assert.ok(stdout.includes('Database created'))
    assert.ok(!/^slipway v\d/.test(stdout))
    for (const flag of ['--version', '-v']) {
      const result = await run(process.execPath, [cli, flag], {
        timeout: 5000
      })
      assert.match(result.stdout, /^slipway v\d/)
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
