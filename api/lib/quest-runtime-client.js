const { spawn } = require('node:child_process')

// This function runs in the selected container without loading Sails, scripts,
// credentials or a second scheduler. The resident socket owns every operation.
function residentRequest(message) {
  const fs = require('node:fs'),
    path = require('node:path'),
    net = require('node:net')
  const directory = '/tmp/slipway-quest-runtimes'
  const reject = (message) => {
    throw new Error(message)
  }
  const candidates = []
  const directoryStat = fs.lstatSync(directory)
  if (!directoryStat.isDirectory() || directoryStat.mode & 0o077)
    reject('Unsafe Quest runtime directory.')
  for (const filename of fs.readdirSync(directory)) {
    if (!/^\d+-\d+-\d+\.json$/.test(filename)) continue
    if (!filename.startsWith(`${message.appId}-${message.deploymentId}-`))
      continue
    try {
      const stat = fs.lstatSync(path.join(directory, filename))
      if (!stat.isFile() || stat.size > 4096 || stat.mode & 0o077) continue
      const identity = JSON.parse(
        fs.readFileSync(path.join(directory, filename), 'utf8')
      )
      if (
        identity.version !== 1 ||
        identity.appId !== String(message.appId) ||
        identity.deploymentId !== String(message.deploymentId) ||
        filename !==
          `${identity.appId}-${identity.deploymentId}-${identity.pid}.json`
      )
        continue
      if (!Number.isSafeInteger(identity.pid) || identity.pid < 1) continue
      const processStat = fs.readFileSync(`/proc/${identity.pid}/stat`, 'utf8')
      const fields = processStat
        .slice(processStat.lastIndexOf(')') + 1)
        .trim()
        .split(/\s+/)
      if (fields[19] !== identity.startTicks) continue
      const status = fs.readFileSync(`/proc/${identity.pid}/status`, 'utf8')
      const uid = Number(status.match(/^Uid:\s+(\d+)/m)?.[1])
      if (stat.uid !== uid || directoryStat.uid !== uid) continue
      const socket = path.join(
        directory,
        `${identity.appId}-${identity.deploymentId}-${identity.pid}.sock`
      )
      const socketStat = fs.lstatSync(socket)
      if (
        identity.socket !== socket ||
        !socketStat.isSocket() ||
        socketStat.uid !== uid ||
        socketStat.mode & 0o077
      )
        continue
      const env = Object.fromEntries(
        fs
          .readFileSync(`/proc/${identity.pid}/environ`, 'utf8')
          .split('\0')
          .filter((line) => line.includes('='))
          .map((line) => [
            line.slice(0, line.indexOf('=')),
            line.slice(line.indexOf('=') + 1)
          ])
      )
      if (
        (env.SLIPWAY_APP_ID || env.SLIPWAY_TELEMETRY_APP_ID) !==
          identity.appId ||
        (env.SLIPWAY_DEPLOYMENT_ID || env.SLIPWAY_TELEMETRY_DEPLOYMENT_ID) !==
          identity.deploymentId ||
        env.SLIPWAY_HELM_EXECUTION_ID
      )
        continue
      if (message.runtimeId && identity.runtimeId !== message.runtimeId)
        continue
      candidates.push(identity)
    } catch {
      /* stale or unreadable registrations are not authority */
    }
  }
  if (candidates.length !== 1)
    reject(
      'Quest needs exactly one verified resident runtime in this container.'
    )
  return new Promise((resolve, reject) => {
    const connection = net.createConnection(candidates[0].socket)
    const chunks = []
    let bytes = 0
    connection.setTimeout(5000, () =>
      connection.destroy(
        new Error(
          'Quest runtime response timed out. The execution outcome is unconfirmed.'
        )
      )
    )
    connection.on('connect', () =>
      connection.write(JSON.stringify(message) + '\n')
    )
    connection.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 512 * 1024)
        connection.destroy(new Error('Quest response exceeded 512 KiB.'))
      else chunks.push(chunk)
    })
    connection.on('error', reject)
    connection.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('Quest returned an invalid response.'))
      }
    })
  })
}

function request(app, command, values = {}, options = {}) {
  if (!app?.containerName || !app.currentDeployment)
    return Promise.reject(
      new Error('The selected app has no verified deployment runtime.')
    )
  const message = {
    ...values,
    command,
    appId: String(app.id),
    deploymentId: String(app.currentDeployment)
  }
  if (Buffer.byteLength(JSON.stringify(message)) > 32 * 1024)
    return Promise.reject(new Error('Quest request exceeds 32 KiB.'))
  const code = `Promise.resolve().then(()=>(${residentRequest.toString()})(${JSON.stringify(
    message
  )})).then(value=>process.stdout.write(JSON.stringify(value))).catch(()=>{process.stderr.write("Resident Quest runtime unavailable. The execution outcome is unconfirmed.");process.exitCode=1})`

  return new Promise((resolve, reject) => {
    const proc = (options.spawn || spawn)(
      options.binary || global.sails?.config.docker?.binaryPath || 'docker',
      ['exec', '-i', app.containerName, 'node'],
      { timeout: 7000, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    let output = [],
      size = 0,
      diagnostic = '',
      settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      error ? reject(error) : resolve(value)
    }
    proc.stdout.on('data', (chunk) => {
      size += chunk.length
      if (size > 512 * 1024) {
        proc.kill()
        finish(new Error('Quest response exceeded 512 KiB.'))
      } else output.push(chunk)
    })
    proc.stderr.on('data', (chunk) => {
      diagnostic = (diagnostic + chunk.toString()).slice(-2048)
    })
    proc.on('error', () =>
      finish(
        new Error(
          'The resident Quest runtime could not be reached. No execution outcome was confirmed.'
        )
      )
    )
    proc.on('close', (code) => {
      if (code !== 0)
        return finish(
          new Error(diagnostic || 'Resident Quest runtime unavailable.')
        )
      try {
        const response = JSON.parse(Buffer.concat(output).toString('utf8'))
        if (!response.ok)
          return finish(
            Object.assign(
              new Error(response.error?.message || 'Quest request rejected.'),
              { code: response.error?.code }
            )
          )
        finish(null, response.data)
      } catch {
        finish(new Error('Resident Quest response was invalid.'))
      }
    })
    proc.stdin.on('error', () => {})
    proc.stdin.end(code)
  })
}
module.exports = { request, residentRequest }
