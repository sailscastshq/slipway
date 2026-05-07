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
      for (const binding of bindings || []) {
        const hostPort = binding.HostPort || ''
        if (hostPort) {
          runArgs.push('-p', `${hostPort}:${containerPort.replace('/tcp', '')}`)
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

function buildEnvArgs(envVars = []) {
  const normalized = []

  for (const envVar of envVars || []) {
    const value = String(envVar)
    const key = value.split('=')[0]

    if (key === 'NODE_ENV') {
      continue
    }

    normalized.push(value)
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
