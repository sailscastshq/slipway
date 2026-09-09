const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const execute = promisify(execFile)
const fail = (message) => {
  const error = new Error(message)
  error.code = 'CUSTOM_SERVICE'
  throw error
}
const policy = () => ({
  registries: ['docker.io'],
  maxCpus: 4,
  maxMemoryMiB: 4096,
  ...(sails.config.custom.customServices || {})
})
const docker = () => sails.config.docker?.binaryPath || 'docker'
async function command(args, timeout = 30000) {
  try {
    return await execute(docker(), args, {
      timeout,
      maxBuffer: 2 * 1024 * 1024
    })
  } catch (error) {
    if (/No such (?:object|container|image)/i.test(error.stderr || ''))
      error.code = 'DOCKER_MISSING'
    throw error
  }
}
function imageName(value) {
  if (
    typeof value !== 'string' ||
    value.length > 300 ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(value)
  )
    fail('Enter a registry image with an explicit version tag or digest.')
  const last = value.split('/').pop()
  if (
    !(
      /:[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(last) ||
      /@sha256:[a-f0-9]{64}$/.test(value)
    ) ||
    /:latest$/i.test(value)
  )
    fail(
      'Choose an explicit version; latest and untagged images are not supported.'
    )
  const first = value.split('/')[0]
  const registry =
    value.includes('/') && /[.:]|^localhost$/.test(first)
      ? first.toLowerCase()
      : 'docker.io'
  if (!policy().registries.includes(registry))
    fail(
      `This image registry is not allowed by the instance policy: ${registry}.`
    )
  if (policy().images && !policy().images.includes(value))
    fail('This image is not allowed by the instance policy.')
  return { value, registry }
}
function dataPath(value) {
  if (
    typeof value !== 'string' ||
    !/^\/[a-zA-Z0-9_./-]+$/.test(value) ||
    path.posix.normalize(value) !== value ||
    value === '/' ||
    /^\/(proc|sys|dev|run|etc|bin|sbin|lib|lib64|usr)(\/|$)/.test(value) ||
    value.startsWith('/var/run')
  )
    fail('Use an absolute application data path, outside system directories.')
  return value
}
function strings(values, label, max = 32) {
  if (
    !Array.isArray(values) ||
    values.length > max ||
    values.some(
      (v) => typeof v !== 'string' || v.length > 4096 || /[\0\r\n]/.test(v)
    )
  )
    fail(`Enter a bounded list of single-line ${label}.`)
  return values
}
function validate(input, metadata = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('Enter a custom service definition.')
  const allowed = [
    'image',
    'name',
    'port',
    'env',
    'volumes',
    'command',
    'healthCommand',
    'cpus',
    'memoryMiB',
    'appIds'
  ]
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    fail('This definition contains an unsupported Docker option.')
  imageName(input.image)
  const name =
    input.name || input.image.split('/').pop().split(/[:@]/)[0].toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{0,49}$/.test(name))
    fail(
      'Use a service name of up to 50 lowercase letters, numbers or hyphens.'
    )
  const declared = Object.keys(metadata.ExposedPorts || {})
    .filter((p) => p.endsWith('/tcp'))
    .map((p) => Number(p.split('/')[0]))
  const port =
    input.port == null || input.port === ''
      ? declared.length === 1
        ? declared[0]
        : null
      : Number(input.port)
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535))
    fail('Choose an internal port between 1 and 65535.')
  const cpus = Number(input.cpus ?? 0.5),
    memoryMiB = Number(input.memoryMiB ?? 256)
  if (
    !Number.isFinite(cpus) ||
    cpus < 0.1 ||
    cpus > policy().maxCpus ||
    !Number.isInteger(memoryMiB) ||
    memoryMiB < 64 ||
    memoryMiB > policy().maxMemoryMiB
  )
    fail(
      'Resource limits exceed the instance policy (minimum 0.1 CPU and 64 MiB).'
    )
  const env = input.env || {}
  if (
    typeof env !== 'object' ||
    Array.isArray(env) ||
    Object.keys(env).length > 100 ||
    Object.entries(env).some(
      ([k, v]) =>
        !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ||
        typeof v !== 'string' ||
        v.length > 16384 ||
        /[\0\r\n]/.test(v)
    )
  )
    fail('Environment variables must have valid keys and single-line values.')
  if (Buffer.byteLength(JSON.stringify(env)) > 128 * 1024)
    fail('Service environment variables exceed 128 KiB.')
  const volumes = [
    ...new Set([
      ...Object.keys(metadata.Volumes || {}),
      ...strings(input.volumes || [], 'data paths', 8)
    ])
  ].map(dataPath)
  if (
    volumes.length > 8 ||
    volumes.some((p, i) =>
      volumes.some((other, j) => i !== j && p.startsWith(other + '/'))
    )
  )
    fail('Use at most eight non-overlapping data paths.')
  if (input.appIds && !Array.isArray(input.appIds))
    fail('Choose valid app IDs.')
  const appIds = strings((input.appIds || []).map(String), 'app IDs', 50)
  if (appIds.length && !port)
    fail('Choose the primary internal port before linking apps.')
  return {
    image: input.image,
    name,
    port,
    env,
    volumes,
    command: strings(input.command || [], 'command arguments'),
    healthCommand: strings(
      input.healthCommand || [],
      'health command arguments'
    ),
    cpus,
    memoryMiB,
    appIds: [...new Set(appIds)]
  }
}
async function inspectImage(image) {
  imageName(image)
  try {
    await command(['pull', image], 120000)
    const data = JSON.parse(
      (await command(['image', 'inspect', image])).stdout
    )[0]
    if (!/^sha256:[a-f0-9]{64}$/.test(data.Id))
      fail('Docker did not resolve an immutable image.')
    return data
  } catch (error) {
    if (error.code === 'CUSTOM_SERVICE') throw error
    fail(
      'The image could not be pulled and inspected. Check its name, registry access and Docker.'
    )
  }
}
function publicDefinition(definition) {
  const { env, command, healthCommand, ...rest } = definition
  return {
    ...rest,
    envKeys: Object.keys(env),
    command: command.length ? ['[custom command]'] : [],
    healthCommand: healthCommand.length ? ['[custom health check]'] : []
  }
}
function argsFor(service, definition, envFile) {
  const args = [
    'create',
    '--name',
    service.containerName,
    '--label',
    `slipway.custom-service=${service.id}`,
    '--network',
    sails.config.custom.slipwayNetwork || 'slipway',
    '--restart',
    'unless-stopped',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--pids-limit',
    '256',
    '--cpus',
    String(definition.cpus),
    '--memory',
    `${definition.memoryMiB}m`,
    '--memory-swap',
    `${definition.memoryMiB}m`
  ]
  for (const mount of service.customState.volumes)
    args.push(
      '--mount',
      `type=volume,source=${mount.name},target=${mount.path}`
    )
  // Docker runs health commands inside the container shell. Quote each argument;
  // no host shell executes this string.
  if (definition.healthCommand.length)
    args.push(
      '--health-cmd',
      definition.healthCommand
        .map((v) => "'" + v.replace(/'/g, "'\\''") + "'")
        .join(' '),
      '--health-interval',
      '5s',
      '--health-timeout',
      '3s',
      '--health-retries',
      '3'
    )
  if (Object.keys(definition.env).length) args.push('--env-file', envFile)
  args.push(service.imageReference, ...definition.command)
  return args
}
async function inspectContainer(service) {
  try {
    const data = JSON.parse(
      (await command(['inspect', service.containerName])).stdout
    )[0]
    if (data.Config?.Labels?.['slipway.custom-service'] !== String(service.id))
      fail(
        'The container name belongs to another resource. It was left unchanged.'
      )
    return data
  } catch (e) {
    if (e.code === 'DOCKER_MISSING') return null
    throw e
  }
}
async function observe(service, persist = true) {
  const data = await inspectContainer(service)
  const status = !data ? 'failed' : data.State.Running ? 'running' : 'stopped'
  const health = data?.State?.Health?.Status || 'unverified'
  const customState = {
    ...service.customState,
    health,
    observedAt: Date.now(),
    error: !data
      ? 'Container is missing. Start the service to recreate its saved image and volumes.'
      : data.State.Restarting
      ? 'The container keeps restarting. Check its startup command and logs.'
      : data.State.OOMKilled
      ? 'The container exceeded its memory limit.'
      : null
  }
  if (persist)
    await Service.updateOne({ id: service.id }).set({
      status,
      containerId: data?.Id || null,
      customState
    })
  return { status, customState }
}
async function createContainer(service, definition) {
  let privateDirectory
  try {
    let envFile
    if (Object.keys(definition.env).length) {
      // Linux child-process stdin is a socket, which Docker cannot reopen
      // as an env file. Keep the file in RAM on Linux and private elsewhere.
      privateDirectory = await fs.mkdtemp(
        path.join(
          process.platform === 'linux' ? '/dev/shm' : os.tmpdir(),
          'slipway-custom-env-'
        )
      )
      envFile = path.join(privateDirectory, 'environment')
      await fs.writeFile(
        envFile,
        Object.entries(definition.env)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') + '\n',
        { mode: 0o600, flag: 'wx' }
      )
    }
    await sails.helpers.streams.runProcess.with({
      command: docker(),
      args: argsFor(service, definition, envFile),
      maxOutputBytes: 8192,
      maxStderrBytes: 8192,
      captureStdout: true,
      timeoutMs: 30000
    })
  } finally {
    if (privateDirectory)
      await fs.rm(privateDirectory, { recursive: true, force: true })
  }
}
async function start(service, restart = false) {
  const definition = service.customDefinition
  imageName(definition.image)
  validate(definition)
  try {
    let existing = await inspectContainer(service)
    if (!existing) {
      for (const volume of service.customState.volumes) {
        let found
        try {
          found = JSON.parse(
            (await command(['volume', 'inspect', volume.name])).stdout
          )[0]
        } catch (e) {
          if (!/No such volume/i.test(e.stderr || '')) throw e
        }
        if (
          found &&
          found.Labels?.['slipway.custom-service'] !== String(service.id)
        )
          fail(
            'A data volume belongs to another resource. It was left unchanged.'
          )
        if (!found)
          await command([
            'volume',
            'create',
            '--label',
            `slipway.custom-service=${service.id}`,
            volume.name
          ])
      }
      await createContainer(service, definition)
    }
    await command([
      restart && existing?.State.Running ? 'restart' : 'start',
      service.containerName
    ])
    for (let n = 0; n < 20; n++) {
      const observed = await observe(service, false)
      if (observed.customState.health !== 'starting') return observe(service)
      await new Promise((r) => setTimeout(r, 1000))
    }
    return observe(service)
  } catch (e) {
    const message =
      e.code === 'CUSTOM_SERVICE'
        ? e.message
        : 'Docker could not start the custom service. Check image compatibility, resources and Docker availability.'
    await Service.updateOne({ id: service.id }).set({
      status: 'failed',
      customState: { ...service.customState, error: message }
    })
    fail(message)
  }
}
async function authorize(req, environmentId) {
  const user = await User.forRequest(req)
  const environment = await Environment.findOne({ id: environmentId }).decrypt()
  const project =
    environment && (await Project.findOne({ id: environment.project }))
  if (
    !project ||
    project.team !== user.team ||
    !['owner', 'admin'].includes(user.teamRole)
  )
    fail(
      'Only a team owner or administrator can manage custom services in this environment.'
    )
  await available(environment.id, project.id)
  return { user, environment, project }
}
async function available(environmentId, projectId, serviceId, db) {
  const environment = projectId
    ? null
    : await Environment.findOne({ id: environmentId }).usingConnection(db)
  const scopes = [
    { scopeType: 'environment', environmentId },
    { scopeType: 'project', projectId: projectId || environment?.project },
    serviceId ? { scopeType: 'service', serviceId } : null
  ].filter(Boolean)
  if (
    await CleanupOperation.findOne({
      status: { nin: ['complete'] },
      or: scopes
    }).usingConnection(db)
  )
    fail('Cleanup is pending. Complete it before changing this service.')
}
function redactLogs(line, definition) {
  const secrets = Object.values(definition?.env || {})
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  for (const value of secrets) line = line.split(value).join('[REDACTED]')
  return line
}
function linkValues(service) {
  const key = service.customState.linkPrefix
  return {
    [`${key}_HOST`]: service.internalHost,
    [`${key}_PORT`]: String(service.internalPort)
  }
}
async function links(service, appIds, db) {
  if (appIds.length && !service.internalPort)
    fail('Choose an internal port before linking apps.')
  const apps = await App.find({ environment: service.environment })
    .decrypt()
    .usingConnection(db)
  if (appIds.some((id) => !apps.some((app) => String(app.id) === String(id))))
    fail('Choose apps from this environment.')
  const environment = await Environment.findOne({ id: service.environment })
    .decrypt()
    .usingConnection(db)
  const globalSetting = await Setting.findOne({ key: 'globalEnvVars' })
    .decrypt()
    .usingConnection(db)
  let globalValues = {}
  if (appIds.length && globalSetting) {
    try {
      globalValues = JSON.parse(
        globalSetting.encryptedValue ?? globalSetting.value ?? '{}'
      )
    } catch {
      fail('Global environment configuration could not be read safely.')
    }
  }
  const inherited = { ...globalValues, ...(environment?.envVars || {}) }
  const values = linkValues(service)
  const owner = `custom-service:${service.id}`
  for (const app of apps) {
    const env = { ...(app.envVars || {}), ...(app.secureEnvVars || {}) },
      metadata = { ...app.envVarMetadata }
    const before = JSON.stringify({ env, metadata })
    const selected = appIds.map(String).includes(String(app.id))
    for (const [key, value] of Object.entries(values)) {
      if (selected) {
        if (Object.hasOwn(inherited, key))
          fail(
            `The connection variable ${key} already exists in inherited environment configuration.`
          )
        if (Object.hasOwn(env, key) && metadata[key]?.description !== owner)
          fail(
            `The connection variable ${key} is already in use by ${app.name}.`
          )
        if (metadata[key]?.description === owner && env[key] !== value)
          fail(
            `The connection variable ${key} changed. Resolve it before relinking.`
          )
        env[key] = value
        metadata[key] = {
          kind: 'plain',
          managed: true,
          previewPolicy: 'inherit',
          description: owner
        }
      } else if (metadata[key]?.description === owner) {
        if (env[key] === value) {
          delete env[key]
          delete metadata[key]
        } else {
          metadata[key] = { ...metadata[key], managed: false, description: '' }
        }
      }
    }
    if (before === JSON.stringify({ env, metadata })) continue
    await App.updateOne({ id: app.id })
      .set({ secureEnvVars: env, envVars: {}, envVarMetadata: metadata })
      .usingConnection(db)
  }
  await Service.updateOne({ id: service.id })
    .set({
      customState: { ...service.customState, appIds: appIds.map(String) }
    })
    .usingConnection(db)
}
module.exports = {
  fail,
  policy,
  validate,
  imageName,
  inspectImage,
  publicDefinition,
  argsFor,
  createContainer,
  observe,
  start,
  authorize,
  links,
  linkValues,
  command,
  inspectContainer,
  available,
  redactLogs
}
