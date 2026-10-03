const { test } = require('sounding')
const assert = require('node:assert/strict')
const { pathToFileURL } = require('node:url')
const path = require('node:path')
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
