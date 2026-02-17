import { execFileSync } from 'node:child_process'
import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn, getCredentials } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

const maritimeMessages = {
  pending: [
    'Waiting for the tide...',
    'Checking the compass...',
    'Reading the stars...',
    'Gathering the crew...',
  ],
  building: [
    'Hoisting the sails...',
    'Loading the cargo...',
    'Checking the rigging...',
    'Swabbing the deck...',
    'Tying the knots...',
    'Hammering the hull...',
  ],
  pushing: [
    'Signaling the fleet...',
    'Sending up a flare...',
    'Raising the flag...',
  ],
  deploying: [
    'Charting the course...',
    'Setting sail...',
    'Catching the wind...',
    'Navigating the waters...',
    'Full speed ahead...',
    'Approaching the harbor...',
  ],
}

const statusLabels = {
  pending: 'Waiting',
  building: 'Building',
  pushing: 'Pushing',
  deploying: 'Deploying',
}

function createMessageRotator(spinner, status) {
  const messages = maritimeMessages[status]
  if (!messages) return null
  let index = 0
  const label = statusLabels[status] || status
  spinner.setText(`${label} — ${c.dim(messages[0])}`)
  index = 1
  return setInterval(() => {
    spinner.setText(`${label} — ${c.dim(messages[index % messages.length])}`)
    index++
  }, 4000)
}

export default async function slide(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()
  const environment = options.env || 'production'

  console.log()
  console.log(`  ${c.bold(c.highlight('Sliding'))} ${project.project} ${c.dim('into')} ${environment}`)
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

  // 3. Trigger deployment
  const deploySpin = createSpinner('Starting deployment...').start()

  try {
    const { deployment } = await api.deployments.trigger(
      project.project,
      environment,
      {
        message: options.message,
        appSlug: options.app,
        ...getGitInfo()
      }
    )

    deploySpin.succeed('Deployment started')
    console.log()
    console.log(`  ${c.dim('Deployment ID:')} ${deployment.id}`)
    console.log()

    // 4. Watch deployment status via SSE (with polling fallback)
    const result = await watchDeployment(deployment.id)

    if (result.status === 'running') {
      console.log(`  ${c.success('✓')} Deployment successful`)
      console.log()

      // Get environment info to show URL
      try {
        const { environment: env } = await api.environments.get(project.project, environment)
        if (env.url) {
          console.log(`  ${c.dim('URL:')} ${c.highlight(env.url)}`)
          console.log()
        }
      } catch {
        // Ignore errors fetching URL
      }
    } else if (result.status === 'failed') {
      console.log(`  ${c.error('✗')} Deployment failed`)
      console.log()
      console.log(`  ${c.dim('Run')} ${c.highlight(`slipway logs -d ${deployment.id}`)} ${c.dim('to view logs.')}`)
      console.log()
      process.exit(1)
    } else {
      console.log(`  ${c.warn('!')} Deployment ended with status: ${result.status}`)
      console.log()
    }
  } catch (err) {
    deploySpin.fail('Deployment failed')
    error(err.message)
  }
}

/**
 * Create a tarball of the current directory.
 * Uses `git archive` if in a git repo (respects .gitignore automatically),
 * otherwise falls back to `tar` with sensible exclusions.
 */
function createTarball() {
  const cwd = process.cwd()

  // Check if we're in a git repo
  if (isGitRepo(cwd)) {
    // git archive creates a clean tar from the current HEAD,
    // excluding .git/ and respecting .gitignore
    return execFileSync('git', ['archive', '--format=tar.gz', 'HEAD'], {
      cwd,
      maxBuffer: 500 * 1024 * 1024 // 500MB
    })
  }

  // Fallback: tar with exclusions
  const excludes = [
    'node_modules',
    '.git',
    '.env',
    '.DS_Store',
    '*.log'
  ]

  const args = ['czf', '-', ...excludes.flatMap(e => ['--exclude', e]), '.']

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

/**
 * Extract git metadata (commit, branch, message) if available.
 */
function getGitInfo() {
  try {
    const cwd = process.cwd()
    const gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, stdio: 'pipe' })
      .toString().trim()
    const gitBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, stdio: 'pipe' })
      .toString().trim()
    const gitMessage = execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd, stdio: 'pipe' })
      .toString().trim()
    return { gitCommit, gitBranch, gitMessage }
  } catch {
    return {}
  }
}

/**
 * Watch deployment status using SSE with polling fallback
 */
async function watchDeployment(deploymentId) {
  // Try SSE first
  try {
    return await watchDeploymentSSE(deploymentId)
  } catch {
    // Fall back to polling
    return await watchDeploymentPolling(deploymentId)
  }
}

/**
 * Watch deployment via Server-Sent Events
 */
function watchDeploymentSSE(deploymentId) {
  const { server, token } = getCredentials()

  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    let currentSpin = null
    let lastStatus = ''
    let messageRotatorInterval = null

    const timeout = setTimeout(() => {
      controller.abort()
      if (messageRotatorInterval) clearInterval(messageRotatorInterval)
      if (currentSpin) currentSpin.stop()
      reject(new Error('timeout'))
    }, 10 * 60 * 1000) // 10 minute timeout

    fetch(`${server}/api/v1/deployments/${deploymentId}/stream`, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${token}`
      },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('SSE not available')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        currentSpin = createSpinner('Building...').start()
        messageRotatorInterval = createMessageRotator(currentSpin, 'building')

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })

          // Parse SSE events
          const events = buffer.split('\n\n')
          buffer = events.pop() || ''

          for (const event of events) {
            const dataMatch = event.match(/data:\s*(.+)/)
            if (dataMatch) {
              try {
                const data = JSON.parse(dataMatch[1])

                // Update spinner based on status
                if (data.status !== lastStatus) {
                  lastStatus = data.status
                  if (messageRotatorInterval) clearInterval(messageRotatorInterval)
                  if (currentSpin) currentSpin.stop()

                  if (['building', 'pushing', 'deploying'].includes(data.status)) {
                    currentSpin = createSpinner('...').start()
                    messageRotatorInterval = createMessageRotator(currentSpin, data.status)
                  } else if (data.status === 'running' || data.status === 'failed' || data.status === 'cancelled') {
                    clearTimeout(timeout)
                    controller.abort()
                    resolve({ status: data.status })
                    return
                  }
                }

                // Show build output if available
                if (data.output) {
                  if (messageRotatorInterval) clearInterval(messageRotatorInterval)
                  if (currentSpin) currentSpin.stop()
                  console.log(`  ${c.dim(data.output)}`)
                  if (['building', 'pushing', 'deploying'].includes(lastStatus)) {
                    currentSpin = createSpinner('...').start()
                    messageRotatorInterval = createMessageRotator(currentSpin, lastStatus)
                  }
                }
              } catch {
                // Invalid JSON, ignore
              }
            }
          }
        }

        // Stream ended — resolve with last known status or fall back to polling
        clearTimeout(timeout)
        if (messageRotatorInterval) clearInterval(messageRotatorInterval)
        if (currentSpin) currentSpin.stop()
        if (lastStatus && ['running', 'failed', 'cancelled'].includes(lastStatus)) {
          resolve({ status: lastStatus })
        } else {
          reject(new Error('Stream ended before deployment completed'))
        }
      })
      .catch((err) => {
        clearTimeout(timeout)
        if (messageRotatorInterval) clearInterval(messageRotatorInterval)
        if (currentSpin) currentSpin.stop()
        if (err.name !== 'AbortError') {
          reject(err)
        }
      })
  })
}

/**
 * Watch deployment via polling (fallback)
 */
async function watchDeploymentPolling(deploymentId) {
  const spin = createSpinner('Building...').start()
  let lastStatus = ''
  let messageRotatorInterval = createMessageRotator(spin, 'building')

  const maxAttempts = 300 // 10 minutes at 2s intervals
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(2000)
    attempts++

    try {
      const result = await api.deployments.status(deploymentId)
      const status = result.deployment.status

      // Update spinner text based on status
      if (status !== lastStatus) {
        lastStatus = status
        if (messageRotatorInterval) clearInterval(messageRotatorInterval)

        if (['building', 'pushing', 'deploying'].includes(status)) {
          messageRotatorInterval = createMessageRotator(spin, status)
        } else if (status === 'running' || status === 'failed' || status === 'cancelled') {
          spin.stop()
          return { status }
        }
      }
    } catch {
      // Continue polling on error
    }
  }

  if (messageRotatorInterval) clearInterval(messageRotatorInterval)
  spin.stop()
  return { status: 'timeout' }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
