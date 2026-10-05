const { test } = require('sounding')
const crypto = require('node:crypto')
const {
  parseCommand,
  hashCommand,
  classifyCommand
} = require('../../../../api/lib/helm-command')

test('Helm command argv preserves quoted inputs without evaluating a shell', async ({
  expect
}) => {
  expect(
    parseCommand(
      `sails run rebuild-search --collection="article drafts" --dryRun=false --batchSize=0 --filter='{"published":true}' --empty=""`
    )
  ).toEqual([
    'sails',
    'run',
    'rebuild-search',
    '--collection=article drafts',
    '--dryRun=false',
    '--batchSize=0',
    '--filter={"published":true}',
    '--empty='
  ])
  expect(
    parseCommand(
      `node scripts/report.js 'one;two|three' "$HOME" back\\ slash 'a\\b' ''`
    )
  ).toEqual([
    'node',
    'scripts/report.js',
    'one;two|three',
    '$HOME',
    'back slash',
    'a\\b',
    ''
  ])
})

test('Helm rejects empty, malformed, multiline, shell, environment and implicit-download commands', async ({
  expect
}) => {
  for (const source of [
    '',
    '   ',
    `'' arg`,
    'node\0script',
    'node one\nnode two',
    'node one\rnode two',
    `node 'unterminated`,
    'node trailing\\',
    'node one; node two',
    'node one && node two',
    'node one | cat',
    'node one > out',
    'node `pwd`',
    'NODE_ENV=other sails run job',
    'npx sails run job',
    '/usr/bin/npx sails run job'
  ]) {
    let error
    try {
      parseCommand(source)
    } catch (caught) {
      error = caught
    }
    expect(error?.code).toBe('HELM_COMMAND_INVALID')
  }
})

test('Helm explains JavaScript entered as a command without inspecting executable arguments', async ({
  expect
}) => {
  for (const source of [
    'await User.find()',
    'User.find()',
    'const count = 1',
    'return 0'
  ]) {
    let error
    try {
      classifyCommand(source)
    } catch (caught) {
      error = caught
    }
    expect(error?.code).toBe('HELM_COMMAND_INVALID')
    expect(error?.message).toMatch(/Use JavaScript mode/)
  }
  expect(parseCommand('node -e "await User.find()"')).toEqual([
    'node',
    '-e',
    'await User.find()'
  ])
  expect(parseCommand('sails run report --query="User.find()"')).toEqual([
    'sails',
    'run',
    'report',
    '--query=User.find()'
  ])
})

test('Helm bounds command bytes and argument count independently', async ({
  expect
}) => {
  expect(parseCommand('node é', { maxBytes: 7, maxArgs: 2 })).toEqual([
    'node',
    'é'
  ])
  for (const [source, options] of [
    ['node é', { maxBytes: 6 }],
    ['node a b', { maxArgs: 2 }]
  ]) {
    let error
    try {
      parseCommand(source, options)
    } catch (caught) {
      error = caught
    }
    expect(error?.code).toBe('HELM_COMMAND_INVALID')
  }
})

test('Helm command classification requires mode-separated production arming', async ({
  expect
}) => {
  for (const source of ['sails run dry-run', 'node --version', 'ls']) {
    const classification = classifyCommand(source)
    expect(classification.mutating).toBe(true)
    expect(classification.complete).toBe(false)
    expect(classification.findings[0].kind).toBe('command')
    expect(
      hashCommand(source) ===
        crypto.createHash('sha256').update(source).digest('hex')
    ).toBe(false)
    expect(hashCommand(source)).toBe(hashCommand(source))
    expect(hashCommand(source) === hashCommand(`${source} `)).toBe(false)
  }
})
