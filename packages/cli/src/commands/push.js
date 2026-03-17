import { execFileSync } from 'node:child_process'
import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function push(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()

  console.log()
  console.log(`  ${c.bold(c.highlight('Pushing'))} ${project.project}`)
  console.log()

  // 1. Package source code
  const spin = createSpinner('Packaging source...').start()

  let tarballBuffer
  try {
    tarballBuffer = createTarball()
    const sizeMB = (tarballBuffer.length / 1024 / 1024).toFixed(1)
    spin.succeed(`Source packaged (${sizeMB} MB)`)
  } catch (err) {
    spin.fail('Failed to package source')
    error(err.message)
  }

  // 2. Upload source to server
  const pushSpin = createSpinner('Pushing source...').start()

  try {
    await api.projects.push(project.project, tarballBuffer)
    pushSpin.succeed('Source pushed')
  } catch (err) {
    pushSpin.fail('Failed to push source')
    error(err.message)
  }

  console.log()
  console.log(`  ${c.success('✓')} Source code updated`)
  console.log()
  console.log(`  ${c.dim('To deploy, run:')} ${c.highlight('slipway slide')}`)
  console.log()
}

/**
 * Create a tarball of the current directory.
 * Uses `git archive` if in a git repo (respects .gitignore automatically),
 * otherwise falls back to `tar` with sensible exclusions.
 */
function createTarball() {
  const cwd = process.cwd()

  if (isGitRepo(cwd)) {
    return execFileSync('git', ['archive', '--format=tar.gz', 'HEAD'], {
      cwd,
      maxBuffer: 500 * 1024 * 1024
    })
  }

  // Fallback: tar with exclusions
  const excludes = ['node_modules', '.git', '.env', '.DS_Store', '*.log']

  const args = ['czf', '-', ...excludes.flatMap((e) => ['--exclude', e]), '.']

  return execFileSync('tar', args, {
    cwd,
    maxBuffer: 500 * 1024 * 1024
  })
}

/**
 * Check if a directory is inside a git repository.
 */
function isGitRepo(dir) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: dir,
      stdio: 'pipe'
    })
    return true
  } catch {
    return false
  }
}
