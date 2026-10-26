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
    const host = containerInfo.HostConfig || {}
    const restart = host.RestartPolicy?.Name || 'unless-stopped'
    runArgs.push(
      '--restart',
      restart === 'on-failure' && host.RestartPolicy.MaximumRetryCount
        ? `on-failure:${host.RestartPolicy.MaximumRetryCount}`
        : restart
    )
    for (const [key, flag] of Object.entries({
      Memory: '--memory',
      MemoryReservation: '--memory-reservation',
      CpuShares: '--cpu-shares',
      MemorySwap: '--memory-swap',
      NanoCpus: '--cpus',
      CpuQuota: '--cpu-quota',
      CpuPeriod: '--cpu-period',
      CpusetCpus: '--cpuset-cpus',
      PidsLimit: '--pids-limit',
      ShmSize: '--shm-size'
    })) {
      if (host[key])
        runArgs.push(
          flag,
          String(key === 'NanoCpus' ? host[key] / 1e9 : host[key])
        )
    }
    if (
      host.NetworkMode === 'host' ||
      host.NetworkMode?.startsWith('container:') ||
      host.IpcMode === 'host' ||
      host.IpcMode?.startsWith('container:') ||
      host.PidMode === 'host' ||
      host.PidMode?.startsWith('container:') ||
      host.UTSMode === 'host' ||
      host.Devices?.length ||
      host.DeviceRequests?.length ||
      Object.values(containerInfo.NetworkSettings?.Networks || {}).some(
        (network) => network.IPAMConfig
      )
    )
      throw new Error(
        'Custom host namespaces, devices or static network addressing require operator review before updating.'
      )
    if (containerInfo.Config?.WorkingDir)
      runArgs.push('--workdir', containerInfo.Config.WorkingDir)
    if (containerInfo.Config?.StopSignal)
      runArgs.push('--stop-signal', containerInfo.Config.StopSignal)
    if (host.LogConfig?.Type) {
      runArgs.push('--log-driver', host.LogConfig.Type)
      for (const [key, value] of Object.entries(host.LogConfig.Config || {}))
        runArgs.push('--log-opt', `${key}=${value}`)
    }
    if (host.Init) runArgs.push('--init')
    if (host.OomKillDisable) runArgs.push('--oom-kill-disable')
    if (containerInfo.Config?.StopTimeout != null)
      runArgs.push('--stop-timeout', String(containerInfo.Config.StopTimeout))
    for (const limit of host.Ulimits || [])
      runArgs.push('--ulimit', `${limit.Name}=${limit.Soft}:${limit.Hard}`)
    for (const [key, value] of Object.entries(host.Sysctls || {}))
      runArgs.push('--sysctl', `${key}=${value}`)
    if (host.ReadonlyRootfs) runArgs.push('--read-only')
    if (containerInfo.Config?.User)
      runArgs.push('--user', containerInfo.Config.User)
    for (const [key, flag] of Object.entries({
      Dns: '--dns',
      DnsSearch: '--dns-search',
      DnsOptions: '--dns-option',
      GroupAdd: '--group-add',
      ExtraHosts: '--add-host',
      SecurityOpt: '--security-opt',
      CapAdd: '--cap-add',
      CapDrop: '--cap-drop'
    }))
      for (const value of host[key] || []) runArgs.push(flag, value)
    for (const [key, value] of Object.entries(host.Tmpfs || {}))
      runArgs.push('--tmpfs', `${key}:${value}`)
    if (
      host.Privileged ||
      host.Devices?.length ||
      host.Binds?.some((value) => !containerInfo.Mounts?.length)
    )
      throw new Error(
        'This container has unsupported privileged or device settings. Review its configuration before updating.'
      )

    const networks = Object.keys(containerInfo.NetworkSettings?.Networks || {})
    if (networks.length > 0) {
      runArgs.push('--network', networks[0])
      for (const alias of networkAliases(containerInfo, networks[0]))
        runArgs.push('--network-alias', alias)
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
        key.startsWith('com.docker.') ||
        key === 'slipway.updater.operation'
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
        args.push(
          '-v',
          `${source}:${destination}${
            mount.RW === false || mount.readOnly === true ? ':ro' : ''
          }`
        )
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

function networkAliases(containerInfo, network) {
  return (
    containerInfo.NetworkSettings?.Networks?.[network]?.Aliases || []
  ).filter(
    (alias) =>
      alias !== containerInfo.Id &&
      alias !== containerInfo.Id?.slice(0, 12) &&
      alias !== containerInfo.Name?.replace(/^\//, '')
  )
}
module.exports.networkAliases = networkAliases
