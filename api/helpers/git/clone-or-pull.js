const { execFile } = require('child_process')
const util = require('util')
const fs = require('fs')
const path = require('path')
const os = require('os')
const execFileAsync = util.promisify(execFile)
const deploymentCancellation = require('../../lib/deployment-cancellation')

module.exports = {
  friendlyName: 'Clone or pull',

  description: 'Clone a repository (or pull latest) using an SSH deploy key.',

  inputs: {
    cloneUrl: {
      type: 'string',
      required: true,
      description: 'SSH clone URL (e.g. git@github.com:owner/repo.git)'
    },
    branch: {
      type: 'string',
      required: true,
      description: 'Branch to checkout'
    },
    commit: {
      type: 'string',
      description: 'Exact commit SHA to checkout after fetching the branch.'
    },
    targetDir: {
      type: 'string',
      required: true,
      description: 'Directory to clone into'
    },
    deployKeyPrivate: {
      type: 'string',
      required: true,
      description: 'PEM-encoded private key for SSH auth'
    },
    deploymentId: {
      type: 'string',
      description: 'Deployment ID for logging'
    },
    signal: {
      type: 'ref',
      description: 'Abort signal for an operator-requested cancellation.'
    }
  },

  fn: async function ({
    cloneUrl,
    branch,
    commit,
    targetDir,
    deployKeyPrivate,
    deploymentId,
    signal
  }) {
    deploymentCancellation.throwIfCancelled(signal, deploymentId)
    const exactCommit = isCommitSha(commit) ? commit : null
    // Normalize the key: fix escaped newlines and ensure trailing newline
    let key = deployKeyPrivate.replace(/\\n/g, '\n')
    if (!key.endsWith('\n')) {
      key += '\n'
    }

    if (!key.includes('-----BEGIN')) {
      throw new Error(
        'Deploy key is not in a valid SSH format — it may be corrupted or not decrypted. Re-connect the repository to regenerate the key.'
      )
    }

    // Write deploy key to a temp file
    const keyFile = path.join(
      os.tmpdir(),
      `slipway-deploy-key-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    sails.log.debug(
      `[git] Writing deploy key (${key.length} chars, format: ${key
        .substring(0, 36)
        .trim()})`
    )
    fs.writeFileSync(keyFile, key, { mode: 0o600, encoding: 'utf8' })

    const sshCommand = `ssh -i ${keyFile} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`
    const env = { ...process.env, GIT_SSH_COMMAND: sshCommand }
    const timeout = 120_000

    const log = async (msg) => {
      sails.log.info(`[git] ${msg}`)
      if (deploymentId) {
        try {
          await Deployment.appendBuildLog(deploymentId, `${msg}\n`)
        } catch {
          /* best-effort */
        }
      }
    }

    try {
      // Ensure parent directory exists
      fs.mkdirSync(path.dirname(targetDir), { recursive: true })

      if (fs.existsSync(path.join(targetDir, '.git'))) {
        // Existing repo — fetch + reset to match remote
        await log(`Fetching latest from ${branch}...`)
        await execFileAsync('git', ['fetch', 'origin', branch], {
          cwd: targetDir,
          env,
          timeout,
          signal
        })
        await checkoutSource({
          targetDir,
          branch,
          commit: exactCommit,
          env,
          timeout,
          log,
          signal
        })
      } else {
        // Fresh clone
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true })
        }
        await log(`Cloning ${cloneUrl} (branch: ${branch})...`)
        await execFileAsync(
          'git',
          [
            'clone',
            '--branch',
            branch,
            '--single-branch',
            '--depth',
            '1',
            cloneUrl,
            targetDir
          ],
          { env, timeout, signal }
        )
        await log(`Cloned successfully`)
        await checkoutSource({
          targetDir,
          branch,
          commit: exactCommit,
          env,
          timeout,
          log,
          signal
        })
      }

      // Log the HEAD commit for traceability
      const { stdout: headSha } = await execFileAsync(
        'git',
        ['rev-parse', '--short', 'HEAD'],
        { cwd: targetDir, env, timeout: 5_000, signal }
      )
      await log(`HEAD is now at ${headSha.trim()}`)
    } catch (error) {
      if (signal?.aborted) {
        throw deploymentCancellation.cancellationError(signal, deploymentId)
      }
      throw error
    } finally {
      // Always clean up the key file
      try {
        fs.unlinkSync(keyFile)
      } catch {
        /* ignore */
      }
    }
  }
}

async function checkoutSource({
  targetDir,
  branch,
  commit,
  env,
  timeout,
  log,
  signal
}) {
  if (commit) {
    await log(`Fetching exact commit ${commit.slice(0, 12)}...`)
    await execFileAsync('git', ['fetch', '--depth', '1', 'origin', commit], {
      cwd: targetDir,
      env,
      timeout,
      signal
    })
    await execFileAsync('git', ['checkout', '--detach', commit], {
      cwd: targetDir,
      env,
      timeout: 30_000,
      signal
    })
    await execFileAsync('git', ['reset', '--hard', commit], {
      cwd: targetDir,
      env,
      timeout: 30_000,
      signal
    })
    await log(`Checked out exact commit ${commit.slice(0, 12)}`)
  } else {
    await execFileAsync('git', ['checkout', '-B', branch, `origin/${branch}`], {
      cwd: targetDir,
      env,
      timeout: 30_000,
      signal
    })
    await execFileAsync('git', ['reset', '--hard', `origin/${branch}`], {
      cwd: targetDir,
      env,
      timeout: 30_000,
      signal
    })
    await log(`Updated to latest ${branch}`)
  }

  await execFileAsync('git', ['clean', '-fd'], {
    cwd: targetDir,
    env,
    timeout: 30_000,
    signal
  })
}

function isCommitSha(value) {
  return typeof value === 'string' && /^[a-f0-9]{40,64}$/i.test(value)
}

module.exports._private = { checkoutSource, isCommitSha }
