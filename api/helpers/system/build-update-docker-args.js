module.exports = {
  friendlyName: 'Build update docker args',

  description:
    'Build reusable Docker arguments for the Slipway self-update containers.',

  inputs: {
    containerInfo: {
      type: 'ref',
      required: true,
      description: 'Docker inspect output for the current Slipway container.'
    },
    extraMounts: {
      type: 'ref',
      description: 'Additional mounts that must be present in the next run.'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ containerInfo, extraMounts = [] }) {
    const mountArgs = []
    appendMountArgs(mountArgs, containerInfo.Mounts, extraMounts)

    const runArgs = []

    const networks = Object.keys(containerInfo.NetworkSettings?.Networks || {})
    if (networks.length > 0) {
      runArgs.push('--network', networks[0])
    }

    runArgs.push(...mountArgs)

    const portBindings = containerInfo.HostConfig?.PortBindings || {}
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      const publishedBindings = new Set()
      for (const binding of bindings || []) {
        const hostPort = binding.HostPort || ''
        if (hostPort) {
          const publishedBinding = formatPortBinding(
            binding.HostIp,
            hostPort,
            containerPort.replace('/tcp', '')
          )
          if (publishedBindings.has(publishedBinding)) continue
          publishedBindings.add(publishedBinding)
          runArgs.push('-p', publishedBinding)
        }
      }
    }

    const envArgs = buildEnvArgs(containerInfo.Config?.Env)
    runArgs.push(...envArgs)

    for (const [key, value] of Object.entries(
      containerInfo.Config?.Labels || {}
    )) {
      if (
        key.startsWith('org.opencontainers.') ||
        key.startsWith('com.docker.')
      ) {
        continue
      }
      runArgs.push('-l', `${key}=${value}`)
    }

    return { runArgs, mountArgs, envArgs }
  }
}

function formatPortBinding(host, hostPort, containerPort) {
  const normalizedHost = String(host || '0.0.0.0').trim() || '0.0.0.0'

  if (normalizedHost === '0.0.0.0' || normalizedHost === '::') {
    return `${hostPort}:${containerPort}`
  }

  const formattedHost = normalizedHost.includes(':')
    ? `[${normalizedHost}]`
    : normalizedHost
  return `${formattedHost}:${hostPort}:${containerPort}`
}

function buildEnvArgs(envVars = []) {
  const normalized = []
  let hasAppPortHost = false

  for (const envVar of envVars || []) {
    const value = String(envVar)
    const key = value.split('=')[0]

    if (key === 'NODE_ENV') {
      continue
    }

    if (key === 'SLIPWAY_APP_PORT_HOST') {
      hasAppPortHost = true
    }

    normalized.push(value)
  }

  // Releases before the private-ingress default always published routable
  // apps. Preserve that behavior during self-update; fresh installs pass an
  // explicit loopback value.
  if (!hasAppPortHost) {
    normalized.push('SLIPWAY_APP_PORT_HOST=0.0.0.0')
  }
  normalized.push('NODE_ENV=production')

  return normalized.flatMap((envVar) => ['-e', envVar])
}

function appendMountArgs(args, mounts = [], extraMounts = []) {
  const seenDestinations = new Set()

  for (const mount of [...(mounts || []), ...(extraMounts || [])]) {
    const type = mount.Type || mount.type
    const destination = mount.Destination || mount.destination

    if (!type || !destination || seenDestinations.has(destination)) {
      continue
    }

    seenDestinations.add(destination)

    if (type === 'volume') {
      const source = mount.Name || mount.name || mount.Source || mount.source
      if (source) {
        args.push('-v', `${source}:${destination}`)
      }
      continue
    }

    if (type === 'bind') {
      const source = mount.Source || mount.source
      if (!source) {
        continue
      }

      const readOnly =
        mount.RW === false || mount.readOnly === true ? ':ro' : ''
      args.push('-v', `${source}:${destination}${readOnly}`)
    }
  }
}
