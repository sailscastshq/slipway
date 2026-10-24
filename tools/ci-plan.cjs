#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

async function main() {
  const flags = process.argv.slice(2)
  if (
    flags.length !== 4 ||
    flags[0] !== '--repo' ||
    flags[2] !== '--commit' ||
    !/^[a-f0-9]{40}$/.test(flags[3])
  )
    throw new Error(
      'Usage: node tools/ci-plan.cjs --repo PATH --commit FULL_SHA'
    )
  const repo = fs.realpathSync(flags[1])
  const commit = flags[3]
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    })
  const resolved = git('rev-parse', '--verify', `${commit}^{commit}`).trim()
  if (resolved !== commit)
    throw new Error('The exact committed revision is unavailable.')
  const names = git('ls-tree', '--name-only', commit).trim().split('\n')
  const lockfiles = [
    'npm-shrinkwrap.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock'
  ].filter((name) => names.includes(name))
  const manifestText = git('show', `${commit}:package.json`)
  const manifest = JSON.parse(manifestText)
  const plan = await require('../api/helpers/ci/discover-plan').fn({
    manifest,
    lockfiles
  })
  const lockfileDigests = Object.fromEntries(
    lockfiles.map((name) => [
      name,
      'sha256:' +
        crypto
          .createHash('sha256')
          .update(git('show', `${commit}:${name}`))
          .digest('hex')
    ])
  )
  process.stdout.write(
    JSON.stringify(
      {
        prototype: true,
        executionStatus: 'not-run',
        mode: 'shadow',
        repository: manifest.name || path.basename(repo),
        sourceRevision: commit,
        manifestDigest:
          'sha256:' +
          crypto.createHash('sha256').update(manifestText).digest('hex'),
        lockfileDigests,
        plan
      },
      null,
      2
    ) + '\n'
  )
}
main().catch((error) => {
  process.stderr.write(error.message + '\n')
  process.exitCode = 1
})
