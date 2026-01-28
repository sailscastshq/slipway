import { c } from '../lib/colors.js'
import { prompt } from '../lib/prompt.js'
import { setCredentials, getCredentials } from '../lib/config.js'
import { error, createSpinner } from '../lib/utils.js'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'

// Open URL in default browser (using spawn for safety)
function openBrowser(url) {
  const plat = platform()

  let cmd, args
  if (plat === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (plat === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    cmd = 'xdg-open'
    args = [url]
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
    child.unref()
  })
}

export default async function login(options) {
  console.log()
  console.log(`  ${c.bold(c.highlight('Slipway Login'))}`)
  console.log()

  // Get server URL
  let serverUrl = options.server

  if (!serverUrl) {
    const existing = getCredentials().server
    serverUrl = await prompt('  Slipway server URL', existing || 'http://localhost:1337')
  }

  // Normalize URL
  serverUrl = serverUrl.replace(/\/$/, '')

  try {
    // Step 1: Request a login session from the server
    const initResponse = await fetch(`${serverUrl}/api/v1/cli/auth/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    if (!initResponse.ok) {
      const body = await initResponse.json().catch(() => ({}))
      error(body.message || 'Failed to initialize login session')
    }

    const { code, loginUrl } = await initResponse.json()

    // Step 2: Open browser for authentication
    console.log(`  ${c.dim('Opening browser to complete authentication...')}`)
    console.log()
    console.log(`  ${c.dim('If the browser doesn\'t open, visit:')}`)
    console.log(`  ${c.highlight(loginUrl)}`)
    console.log()
    console.log(`  ${c.dim('Your confirmation code:')} ${c.bold(code)}`)
    console.log()

    const opened = await openBrowser(loginUrl)
    if (!opened) {
      console.log(`  ${c.warn('Could not open browser automatically.')}`)
      console.log(`  ${c.dim('Please open the URL above manually.')}`)
      console.log()
    }

    // Step 3: Wait for authentication via SSE (with polling fallback)
    const spin = createSpinner('Waiting for authentication...').start()

    const result = await waitForAuth(serverUrl, code)

    if (!result.authenticated) {
      spin.fail(result.error || 'Authentication failed')
      error('Please try again')
    }

    // Step 4: Save credentials
    setCredentials({
      server: serverUrl,
      token: result.token,
      user: result.user
    })

    spin.succeed('Logged in successfully')
    console.log()

    if (result.user) {
      console.log(`  ${c.dim('Logged in as:')} ${result.user.email}`)
      console.log(`  ${c.dim('Server:')} ${serverUrl}`)
    }

    console.log()
  } catch (err) {
    error(`Could not connect to server: ${err.message}`)
  }
}

/**
 * Wait for authentication using SSE with polling fallback
 */
async function waitForAuth(serverUrl, code) {
  // Try SSE first
  try {
    return await waitForAuthSSE(serverUrl, code)
  } catch {
    // Fall back to polling if SSE fails
    return await waitForAuthPolling(serverUrl, code)
  }
}

/**
 * Wait for auth via Server-Sent Events
 */
function waitForAuthSSE(serverUrl, code) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
      reject(new Error('timeout'))
    }, 5 * 60 * 1000) // 5 minute timeout

    fetch(`${serverUrl}/api/v1/cli/auth/stream?code=${code}`, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('SSE not available')
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

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
                if (data.status === 'authenticated') {
                  clearTimeout(timeout)
                  controller.abort()
                  resolve({
                    authenticated: true,
                    token: data.token,
                    user: data.user
                  })
                  return
                } else if (data.status === 'expired') {
                  clearTimeout(timeout)
                  controller.abort()
                  resolve({
                    authenticated: false,
                    error: 'Login session expired'
                  })
                  return
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
        if (err.name !== 'AbortError') {
          reject(err)
        }
      })
  })
}

/**
 * Wait for auth via polling (fallback)
 */
async function waitForAuthPolling(serverUrl, code) {
  const maxAttempts = 120 // 2 minutes
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(1000)
    attempts++

    try {
      const response = await fetch(`${serverUrl}/api/v1/cli/auth/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      })

      if (response.ok) {
        const result = await response.json()

        if (result.status === 'authenticated') {
          return {
            authenticated: true,
            token: result.token,
            user: result.user
          }
        } else if (result.status === 'expired') {
          return {
            authenticated: false,
            error: 'Login session expired'
          }
        }
      }
    } catch {
      // Network error, keep trying
    }
  }

  return {
    authenticated: false,
    error: 'Authentication timed out'
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
