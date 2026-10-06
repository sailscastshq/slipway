const path = require('node:path')
function fail() {
  throw Object.assign(
    new Error('The exact existing launch configuration is required.'),
    { code: 'upgradeLaunchConfig' }
  )
}
module.exports = function launchConfig({
  current,
  imageConfig,
  image,
  stage,
  marker,
  instanceId,
  manifestHash,
  runId,
  stateRoot,
  hostCheckpoint
}) {
  if (
    !current?.Config ||
    !current.HostConfig ||
    !imageConfig ||
    !/^.+@sha256:[a-f0-9]{64}$/.test(image || '') ||
    !path.isAbsolute(stage?.dataDirectory || '') ||
    !path.isAbsolute(marker || '') ||
    !instanceId ||
    !manifestHash ||
    !runId
  )
    fail()
  if (
    !['', 'root', '0', '0:0'].includes(current.Config.User || '') ||
    !['', 'root', '0', '0:0'].includes(imageConfig.User || '') ||
    current.HostConfig.VolumesFrom?.length
  )
    fail()
  const data = current.Mounts.filter((mount) => mount.Destination === '/app/db')
  if (data.length !== 1 || !data[0].RW) fail()
  const networkNames = Object.keys(current.NetworkSettings?.Networks || {})
  if (networkNames.length !== 1) fail()
  if (
    stateRoot &&
    (!path.isAbsolute(stateRoot) ||
      !stage.directory.startsWith(stateRoot + path.sep) ||
      !hostCheckpoint?.startsWith(stateRoot + path.sep))
  )
    fail()
  const previousMarker = current.Config.Env?.find((value) =>
    value.startsWith('SLIPWAY_UPGRADE_MARKER=')
  )?.slice('SLIPWAY_UPGRADE_MARKER='.length)
  const mounts = current.Mounts.filter(
    (mount) =>
      !stateRoot ||
      (mount.Destination !== stateRoot &&
        mount.Destination !== (previousMarker && path.dirname(previousMarker)))
  ).map((mount) => {
    if (
      !['bind', 'volume'].includes(mount.Type) ||
      !path.isAbsolute(mount.Destination)
    )
      fail()
    return mount.Destination === '/app/db'
      ? {
          Type: 'bind',
          Source: stage.dataDirectory,
          Target: '/app/db',
          ReadOnly: false
        }
      : {
          Type: mount.Type,
          Source: mount.Type === 'volume' ? mount.Name : mount.Source,
          Target: mount.Destination,
          ReadOnly: !mount.RW
        }
  })
  // Canonical journal paths remain visible for native inode/receipt checks.
  mounts.push({
    Type: 'bind',
    Source: stage.directory,
    Target: stage.directory,
    ReadOnly: true
  })
  if (stateRoot)
    mounts.push({
      Type: 'bind',
      Source: stateRoot,
      Target: stateRoot,
      ReadOnly: true
    })
  const replaced = new Set([
    'NODE_ENV',
    'SLIPWAY_MIGRATE',
    'SLIPWAY_UPGRADE_MARKER',
    'SLIPWAY_UPGRADE_IMAGE',
    'SLIPWAY_UPGRADE_INSTANCE',
    'SLIPWAY_UPGRADE_MANIFEST',
    'SLIPWAY_UPGRADE_STATE_ROOT',
    'SLIPWAY_UPGRADE_CONTAINER',
    'SLIPWAY_UPGRADE_HOST_CHECKPOINT'
  ])
  const env = (current.Config.Env || []).filter(
    (value) => !replaced.has(String(value).split('=')[0])
  )
  env.push(
    'NODE_ENV=production',
    'SLIPWAY_MIGRATE=safe',
    `SLIPWAY_UPGRADE_MARKER=${marker}`,
    `SLIPWAY_UPGRADE_IMAGE=${image}`,
    `SLIPWAY_UPGRADE_INSTANCE=${instanceId}`,
    `SLIPWAY_UPGRADE_MANIFEST=${manifestHash}`
  )
  if (stateRoot)
    env.push(
      `SLIPWAY_UPGRADE_STATE_ROOT=${stateRoot}`,
      `SLIPWAY_UPGRADE_CONTAINER=${
        current.Name?.replace(/^\//, '') || 'slipway'
      }`,
      `SLIPWAY_UPGRADE_HOST_CHECKPOINT=${hostCheckpoint}`
    )
  return {
    Image: image,
    User: current.Config.User || imageConfig.User || '',
    Env: env,
    Entrypoint: imageConfig.Entrypoint,
    Cmd: imageConfig.Cmd,
    WorkingDir: imageConfig.WorkingDir,
    ExposedPorts: current.Config.ExposedPorts || {},
    Labels: {
      ...current.Config.Labels,
      'io.slipway.upgrade.run': runId,
      'io.slipway.upgrade.manifest': manifestHash
    },
    HostConfig: {
      ...Object.fromEntries(
        [
          'CapAdd',
          'CapDrop',
          'SecurityOpt',
          'ReadonlyRootfs',
          'PidsLimit',
          'Ulimits',
          'GroupAdd',
          'UsernsMode',
          'CgroupnsMode',
          'ExtraHosts',
          'Dns',
          'DnsOptions',
          'DnsSearch',
          'IpcMode',
          'ShmSize',
          'OomKillDisable',
          'OomScoreAdj',
          'Privileged',
          'Devices',
          'DeviceRequests',
          'DeviceCgroupRules'
        ]
          .filter((key) => Object.hasOwn(current.HostConfig, key))
          .map((key) => [key, current.HostConfig[key]])
      ),
      Mounts: mounts,
      PortBindings: current.HostConfig.PortBindings || {},
      NetworkMode: networkNames[0],
      RestartPolicy: { Name: 'no' },
      LogConfig: current.HostConfig.LogConfig,
      Memory: current.HostConfig.Memory || 0,
      NanoCpus: current.HostConfig.NanoCpus || 0
    },
    NetworkingConfig: { EndpointsConfig: { [networkNames[0]]: {} } }
  }
}
