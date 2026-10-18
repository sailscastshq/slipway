const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const execute = promisify(execFile)
const installer = path.resolve('local.sh')

async function fixture(t) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), 'slipway-local-destroy-')
  )
  const bin = path.join(root, 'bin')
  const state = path.join(root, 'local-state')
  const log = path.join(root, 'commands.jsonl')
  const recovered = path.join(root, 'recovered')
  await fs.mkdir(bin)
  await fs.mkdir(path.join(state, 'db', 'instance-quest'), {
    recursive: true,
    mode: 0o700
  })
  await fs.writeFile(
    path.join(state, 'db', 'instance-quest', 'fixture.json'),
    '{}',
    { mode: 0o600 }
  )
  for (const name of ['docker', 'rm']) {
    const source =
      `#!${process.execPath}\n` +
      `const fs = require('node:fs'); const args=process.argv.slice(2); fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify({name:${JSON.stringify(
        name
      )},args})+'\\n');\n` +
      (name === 'docker'
        ? `if(args[0]==='run') fs.writeFileSync(process.env.FIXTURE_RECOVERED,'yes');\n`
        : `if(!fs.existsSync(process.env.FIXTURE_RECOVERED)) process.exit(1); fs.rmSync(args.at(-1),{recursive:true,force:true});\n`)
    await fs.writeFile(path.join(bin, name), source, { mode: 0o700 })
  }
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    SLIPWAY_LOCAL_ROOT: state,
    SLIPWAY_LOCAL_IMAGE: 'fixture-only:latest',
    FIXTURE_LOG: log,
    FIXTURE_RECOVERED: recovered
  }
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  return { state, log, env }
}

test('local destroy recovers private container-owned state using only its bounded mount', async (t) => {
  const { state, log, env } = await fixture(t)
  await execute('bash', [installer, 'destroy'], { env })
  await assert.rejects(fs.stat(state), { code: 'ENOENT' })
  const commands = (await fs.readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  const run = commands.find(
    (command) => command.name === 'docker' && command.args[0] === 'run'
  )
  assert.ok(run)
  assert.ok(
    run.args.includes(
      `type=bind,source=${await fs.realpath(
        path.dirname(state)
      )}/local-state,target=/local-state`
    )
  )
  assert.equal(run.args.filter((arg) => arg === '--mount').length, 1)
  assert.ok(!run.args.includes('-v'))
  assert.ok(run.args.includes('none'))
  assert.ok(run.args.includes('--no-dereference'))
  assert.ok(run.args.includes('-P'))
  assert.equal(run.args.at(-1), '/local-state')
  assert.ok(!JSON.stringify(run.args).includes('docker.sock'))
  assert.equal(commands.filter((command) => command.name === 'rm').length, 2)
})

test('local destroy refuses a root or installation-parent override before removing resources', async (t) => {
  const { log, env } = await fixture(t)
  for (const override of ['/', path.dirname(installer)]) {
    await assert.rejects(
      execute('bash', [installer, 'destroy'], {
        env: { ...env, SLIPWAY_LOCAL_ROOT: override }
      }),
      /Refusing to destroy/
    )
  }
  const commands = (await fs.readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse)
  assert.ok(
    commands.every(
      (command) => command.name === 'docker' && command.args[0] === 'info'
    )
  )
})
