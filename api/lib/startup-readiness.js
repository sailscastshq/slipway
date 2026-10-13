const { performance } = require('node:perf_hooks')
const cancellation = require('./deployment-cancellation')
function failure(message, code) {
  return Object.assign(new Error(message), { code })
}
async function poll(options, dependencies) {
  const {
    timeout,
    interval,
    signal,
    deploymentId,
    containerName,
    port,
    hostPort,
    path
  } = options
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    timeout > 600000 ||
    !Number.isSafeInteger(interval) ||
    interval < 1 ||
    interval > 10000
  )
    throw failure(
      'Startup timeout or polling interval is outside its supported bound.',
      'INVALID_STARTUP_WINDOW'
    )
  const now = dependencies.now || (() => performance.now())
  const started = now(),
    deadline = started + timeout
  let attempts = 0,
    fallback = false,
    lastError = 'No readiness response.',
    lastCode,
    lastState,
    nextProgress = started + 15000
  while (now() < deadline) {
    cancellation.throwIfCancelled(signal, deploymentId)
    if (dependencies.inspect) {
      try {
        lastState = await dependencies.inspect(
          Math.max(1, Math.min(5000, Math.ceil(deadline - now())))
        )
        if (
          ['exited', 'dead', 'restarting'].includes(lastState?.status) ||
          lastState?.restarting
        )
          throw failure(
            `Candidate stopped during startup after ${Math.round(
              (now() - started) / 1000
            )}s: state ${lastState.status}, exit code ${
              lastState.exitCode ?? 'unknown'
            }${
              lastState.oomKilled ? ', out of memory' : ''
            }. Review startup diagnostics below.`,
            'DEPLOYMENT_STARTUP_EXITED'
          )
      } catch (error) {
        cancellation.throwIfCancelled(signal, deploymentId)
        if (error.code === 'DEPLOYMENT_STARTUP_EXITED') throw error
        if (
          error === 'notFound' ||
          ['notFound', 'E_NOT_FOUND'].includes(error.code) ||
          error.exitCode === 'notFound'
        )
          throw failure(
            'Candidate container disappeared during startup. Review startup diagnostics below.',
            'DEPLOYMENT_CANDIDATE_MISSING'
          )
        lastState = null
      }
    }
    const remaining = Math.ceil(deadline - now())
    if (remaining <= 0) break
    attempts++
    const host = fallback ? 'localhost' : containerName
    const checkPort = fallback ? hostPort : port
    const endpoint = `http://${host}:${checkPort}${path}`
    try {
      const statusCode = await dependencies.request(
        host,
        checkPort,
        path,
        signal,
        deploymentId,
        Math.min(5000, remaining)
      )
      cancellation.throwIfCancelled(signal, deploymentId)
      if (now() >= deadline) break
      if (statusCode >= 200 && statusCode < 300)
        return {
          statusCode,
          attempts,
          elapsedMs: Math.round(now() - started),
          windowMs: timeout,
          host,
          port: checkPort
        }
      lastError = `${endpoint} returned HTTP ${statusCode}`
      lastCode = 'HTTP_RESPONSE'
    } catch (error) {
      cancellation.throwIfCancelled(signal, deploymentId)
      if (
        !fallback &&
        hostPort &&
        ['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)
      ) {
        fallback = true
        await dependencies.log?.(
          `Docker DNS unavailable, falling back to localhost:${hostPort}\n`
        )
        continue
      }
      lastError =
        dependencies.sanitize?.(error.message || 'Readiness request failed.') ||
        error.message ||
        'Readiness request failed.'
      lastCode = error.code
    }
    if (now() >= nextProgress && now() < deadline) {
      await dependencies.log?.(
        `Startup still waiting after ${Math.round(
          (now() - started) / 1000
        )}s: ${lastError}\n`
      )
      nextProgress = now() + 15000
    }
    const delay = Math.min(interval, Math.max(0, deadline - now()))
    if (delay > 0) await dependencies.delay(delay, signal, deploymentId)
  }
  cancellation.throwIfCancelled(signal, deploymentId)
  const elapsed = Math.round((now() - started) / 1000)
  const detail = lastState?.running
    ? ['ECONNREFUSED', 'ETIMEDOUT'].includes(lastCode)
      ? 'Candidate is still running, but its configured port did not return a readiness response. Check startup logs, PORT, and the health path.'
      : 'Candidate is still running but did not become ready. Check startup logs and the health path.'
    : 'Candidate state could not be confirmed; review startup diagnostics.'
  throw failure(
    `Health check failed after ${elapsed}s (${attempts} attempts). ${detail} Last error: ${lastError}`,
    'DEPLOYMENT_STARTUP_TIMEOUT'
  )
}
module.exports = { poll, failure }
