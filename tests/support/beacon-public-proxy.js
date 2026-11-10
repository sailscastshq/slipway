const http = require('node:http')
const net = require('node:net')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

// Exercise production's generated JSON routes with real Caddy. Only the host
// matcher and Docker-only upstream names are replaced for loopback fixtures.
module.exports = async function publicProxy(sails, environment, app, binary) {
  const fixture = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>Harbor app</title><h1>Harbor app</h1>')
  })
  await new Promise((resolve, reject) => {
    fixture.once('error', reject)
    fixture.listen(0, '127.0.0.1', resolve)
  })
  let child
  let directory
  const close = async () => {
    if (child && child.exitCode === null) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
        child.kill('SIGTERM')
      })
    }
    fixture.closeAllConnections()
    await new Promise((resolve) => fixture.close(resolve))
    if (directory) await fs.rm(directory, { recursive: true, force: true })
  }
  try {
    const generated = await sails.helpers.caddy.generateRouteConfig.with({
      environmentId: String(environment.id),
      apps: [{ ...app, hostPort: fixture.address().port }]
    })
    const route = JSON.parse(JSON.stringify(generated.route))
    if (!route) throw new Error('Expected a generated public app route')
    route.match = [{ host: ['127.0.0.1'] }]
    const cp = `${sails.config.custom.slipwayContainerName || 'slipway'}:1337`
    const replace = (value) => {
      if (!value || typeof value !== 'object') return
      if (value.dial === cp)
        value.dial = `127.0.0.1:${sails.hooks.http.server.address().port}`
      else if (value.dial?.startsWith('host.docker.internal:'))
        value.dial = `127.0.0.1:${fixture.address().port}`
      for (const entry of Object.values(value)) replace(entry)
    }
    replace(route)
    const reservation = net.createServer()
    await new Promise((resolve, reject) => {
      reservation.once('error', reject)
      reservation.listen(0, '127.0.0.1', resolve)
    })
    const port = reservation.address().port
    await new Promise((resolve) => reservation.close(resolve))
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'beacon-caddy-'))
    const file = path.join(directory, 'caddy.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        admin: { disabled: true },
        apps: {
          http: {
            servers: {
              beacon: {
                listen: [`127.0.0.1:${port}`],
                automatic_https: { disable: true },
                routes: [route]
              }
            }
          }
        }
      })
    )
    let diagnostic = ''
    child = spawn(binary, ['run', '--config', file], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    child.on('error', (error) => {
      diagnostic = error.message
    })
    child.stdout.on('data', (data) => {
      diagnostic = (diagnostic + data).slice(-4000)
    })
    child.stderr.on('data', (data) => {
      diagnostic = (diagnostic + data).slice(-4000)
    })
    const origin = `http://127.0.0.1:${port}`
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(diagnostic)
      try {
        if (
          (await fetch(origin + '/ready', { signal: AbortSignal.timeout(500) }))
            .ok
        )
          return { origin, close }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('Local Caddy did not start: ' + diagnostic)
  } catch (error) {
    await close()
    throw error
  }
}
