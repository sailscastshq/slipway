const { test } = require('sounding')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execSync, execFileSync } = require('node:child_process')
const command = require('../../../api/lib/git-ssh-command')

test('deployment SSH uses strict pinned trust and only its own identity', async ({
  expect
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway ssh '))
  const key = path.join(root, 'identity')
  fs.writeFileSync(key, '')
  try {
    const config = execSync(`${command(key)} -G github.com`, {
      encoding: 'utf8'
    })
    expect(config).toContain('stricthostkeychecking true')
    expect(config).toContain('batchmode yes')
    expect(config).toContain('identitiesonly yes')
    expect(config).toContain('identityagent none')
    expect(config).toContain(`identityfile ${key}`)
    const pins = execFileSync(
      'ssh-keygen',
      ['-lf', path.resolve('config/git_known_hosts')],
      { encoding: 'utf8' }
    )
    expect(pins).toContain('SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
