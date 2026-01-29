import { c } from '../lib/colors.js'
import { prompt, waitForEnter } from '../lib/prompt.js'
import { setCredentials, getCredentials } from '../lib/config.js'
import { error } from '../lib/utils.js'
import { spawn } from 'node:child_process'
import { platform } from 'node:os'

// Open URL in default browser (fire and forget)
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

  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.unref()
    return true
  } catch {
    return false
  }
}

export default async function login(options) {
  console.log()
  console.log(`  ${c.bold(c.highlight('Slipway Login'))}`)
  console.log()

  // Get server URL from (in priority order):
  // 1) --server flag, 2) SLIPWAY_SERVER env var, 3) saved credentials, 4) prompt user
  let serverUrl = options.server
  const savedCredentials = getCredentials()

  if (!serverUrl && process.env.SLIPWAY_SERVER) {
    // Use environment variable
    serverUrl = process.env.SLIPWAY_SERVER
    console.log(`  ${c.dim('Server:')} ${serverUrl} ${c.dim('(from SLIPWAY_SERVER)')}`)
    console.log()
  } else if (!serverUrl && savedCredentials.server) {
    // Use saved server URL
    serverUrl = savedCredentials.server
    console.log(`  ${c.dim('Server:')} ${serverUrl}`)
    console.log(`  ${c.dim('(use --server to change)')}`)
    console.log()
  } else if (!serverUrl) {
    // First time - prompt for server URL
    console.log(`  ${c.dim('Enter your Slipway server URL.')}`)
    console.log(`  ${c.dim('Example: https://slipway.yourcompany.com')}`)
    console.log()
    serverUrl = await prompt('  Server URL')

    if (!serverUrl) {
      error('Server URL is required')
    }
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

    // Step 2: Show login info and wait for user to press ENTER
    console.log(`  ${c.dim('Your confirmation code:')} ${c.bold(code)}`)
    console.log()
    console.log(`  ${c.dim('URL:')} ${c.highlight(loginUrl)}`)
    console.log()

    await waitForEnter('  Press ENTER to open in the browser...')

    console.log()
    console.log(`  ${c.dim('Opening browser...')}`)

    const opened = openBrowser(loginUrl)
    if (!opened) {
      console.log(`  ${c.warn('Could not open browser automatically.')}`)
      console.log(`  ${c.dim('Please open the URL above manually.')}`)
    }

    console.log()
    console.log(`  ${c.dim('Waiting for you to authorize in the browser...')}`)
    console.log()

    // Step 3: Wait for authentication via polling (show dots for progress)
    process.stdout.write('  Checking')

    const result = await waitForAuthPolling(serverUrl, code, () => {
      process.stdout.write('.')
    })

    console.log() // New line after dots

    if (!result.authenticated) {
      console.log(`  ${c.error('✗')} ${result.error || 'Authentication failed'}`)
      error('Please try again')
    }

    // Extract team from user data
    const { team, ...user } = result.user || {}

    // Step 4: Save credentials
    setCredentials({
      server: serverUrl,
      token: result.token,
      user: user.email ? user : null,
      team: team || null
    })

    console.log(`  ${c.success('✓')} Logged in successfully`)
    console.log()

    if (user.email) {
      console.log(`  ${c.dim('Logged in as:')} ${user.email}`)
      if (team) {
        console.log(`  ${c.dim('Team:')} ${team.name}`)
      }
      console.log(`  ${c.dim('Server:')} ${serverUrl}`)
    }

    console.log()
  } catch (err) {
    error(`Could not connect to server: ${err.message}`)
  }
}

/**
 * Wait for auth via polling
 */
async function waitForAuthPolling(serverUrl, code, onProgress) {
  const maxAttempts = 120 // 2 minutes
  let attempts = 0

  while (attempts < maxAttempts) {
    await sleep(1000)
    attempts++

    // Show progress
    if (onProgress) onProgress()

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
        // Still pending, continue polling
      } else if (response.status === 404) {
        // Session expired on server side, keep trying a few more times
        if (attempts > 5) {
          return {
            authenticated: false,
            error: 'Session expired on server'
          }
        }
      }
    } catch (err) {
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
