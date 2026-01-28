import { c } from '../lib/colors.js'
import { api } from '../lib/api.js'
import { isLoggedIn, getCredentials } from '../lib/config.js'
import { error, requireProject, createSpinner } from '../lib/utils.js'

export default async function slide(options) {
  if (!isLoggedIn()) {
    error('Not logged in. Run `slipway login` first.')
  }

  const project = requireProject()
  const environment = options.env || 'production'

  console.log()
  console.log(`  ${c.bold(c.highlight('Sliding'))} ${project.project} ${c.dim('into')} ${environment}`)
  console.log()

  const spin = createSpinner('Starting deployment...').start()

  try {
    // Trigger deployment
    const { deployment } = await api.deployments.trigger(
      project.project,
      environment,
      {
        message: options.message
      }
    )

    spin.succeed('Deployment started')
    console.log()
    console.log(`  ${c.dim('Deployment ID:')} ${deployment.id.substring(0, 8)}`)
    console.log()

    // Watch deployment status via SSE (with polling fallback)
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
      console.log(`  ${c.dim('Run')} ${c.highlight(`slipway logs -d ${deployment.id.substring(0, 8)}`)} ${c.dim('to view logs.')}`)
      console.log()
      process.exit(1)
    } else {
      console.log(`  ${c.warn('!')} Deployment ended with status: ${result.status}`)
      console.log()
    }
  } catch (err) {
    spin.fail('Deployment failed')
    error(err.message)
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

    const timeout = setTimeout(() => {
      controller.abort()
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
                  if (currentSpin) currentSpin.stop()

                  if (data.status === 'building') {
                    currentSpin = createSpinner('Building...').start()
                  } else if (data.status === 'deploying') {
                    currentSpin = createSpinner('Deploying...').start()
                  } else if (data.status === 'running' || data.status === 'failed' || data.status === 'cancelled') {
                    clearTimeout(timeout)
                    controller.abort()
                    resolve({ status: data.status })
                    return
                  }
                }

                // Show build output if available
                if (data.output) {
                  if (currentSpin) currentSpin.stop()
                  console.log(`  ${c.dim(data.output)}`)
                  if (lastStatus === 'building' || lastStatus === 'deploying') {
                    currentSpin = createSpinner(lastStatus === 'building' ? 'Building...' : 'Deploying...').start()
                  }
                }
              } catch {
                // Invalid JSON, ignore
              }
            }
          }
        }
      })
      .catch((err) => {
        clearTimeout(timeout)
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
        spin.stop()

        if (status === 'building') {
          createSpinner('Building...').start()
        } else if (status === 'deploying') {
          createSpinner('Deploying...').start()
        } else if (status === 'running' || status === 'failed' || status === 'cancelled') {
          return { status }
        }
      }
    } catch {
      // Continue polling on error
    }
  }

  spin.stop()
  return { status: 'timeout' }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
