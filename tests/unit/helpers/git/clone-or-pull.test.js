const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const { test } = require('sounding')

const cloneOrPull = require('../../../../api/helpers/git/clone-or-pull')

test('repository deployments check out their recorded commit', async ({
  expect
}) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slipway-git-sync-'))
  const sourceDir = path.join(tempRoot, 'source')
  const targetDir = path.join(tempRoot, 'target')
  const originalSails = global.sails
  const originalDeployment = global.Deployment

  fs.mkdirSync(sourceDir)
  git(['init', '-b', 'main'], sourceDir)
  fs.writeFileSync(path.join(sourceDir, 'version.txt'), 'first\n')
  git(['add', 'version.txt'], sourceDir)
  git(
    [
      '-c',
      'user.name=Slipway Test',
      '-c',
      'user.email=slipway@example.com',
      'commit',
      '-m',
      'chore(content): create version'
    ],
    sourceDir
  )
  const firstCommit = git(['rev-parse', 'HEAD'], sourceDir)

  fs.writeFileSync(path.join(sourceDir, 'version.txt'), 'second\n')
  git(['add', 'version.txt'], sourceDir)
  git(
    [
      '-c',
      'user.name=Slipway Test',
      '-c',
      'user.email=slipway@example.com',
      'commit',
      '-m',
      'chore(content): update version'
    ],
    sourceDir
  )

  global.sails = {
    log: {
      debug: () => {},
      info: () => {}
    }
  }
  global.Deployment = { appendBuildLog: async () => {} }

  try {
    await cloneOrPull.fn({
      cloneUrl: sourceDir,
      branch: 'main',
      commit: firstCommit,
      targetDir,
      deployKeyPrivate:
        '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n'
    })

    expect(git(['rev-parse', 'HEAD'], targetDir)).toBe(firstCommit)
    expect(fs.readFileSync(path.join(targetDir, 'version.txt'), 'utf8')).toBe(
      'first\n'
    )
  } finally {
    global.sails = originalSails
    global.Deployment = originalDeployment
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}
