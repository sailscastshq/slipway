module.exports = {
  friendlyName: 'Parse port bindings',

  description:
    'Compare Docker inspect port bindings with the mapping Slipway requested.',

  inputs: {
    portBindings: {
      type: 'ref',
      required: true,
      description: 'Docker NetworkSettings.Ports value.'
    },
    containerPort: {
      type: 'number',
      required: true
    },
    hostPort: {
      type: 'number',
      required: true
    },
    host: {
      type: 'string',
      defaultsTo: '0.0.0.0'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({ portBindings, containerPort, hostPort, host }) {
    const key = `${containerPort}/tcp`
    const expectedHost = normalizeHost(host)
    const expectedPort = String(hostPort)
    const bindings = Array.isArray(portBindings[key])
      ? portBindings[key].map((binding) => ({
          host: normalizeHost(binding.HostIp),
          port: String(binding.HostPort || '')
        }))
      : []
    const matchingPort = bindings.filter(
      (binding) => binding.port === expectedPort
    )
    const matched = matchingPort.find((binding) =>
      hostMatches(expectedHost, binding.host)
    )

    if (matched) {
      return {
        valid: true,
        containerPort,
        host: matched.host,
        hostPort,
        bindings,
        diagnostic: `Docker published ${matched.host}:${hostPort} -> ${containerPort}/tcp.`
      }
    }

    if (bindings.length === 0) {
      return {
        valid: false,
        containerPort,
        host: expectedHost,
        hostPort,
        bindings,
        diagnostic: `Docker did not publish container port ${containerPort}/tcp.`
      }
    }

    if (matchingPort.length === 0) {
      return {
        valid: false,
        containerPort,
        host: expectedHost,
        hostPort,
        bindings,
        diagnostic: `Docker published container port ${containerPort}/tcp on ${describeBindings(
          bindings
        )}, not the expected host port ${hostPort}.`
      }
    }

    return {
      valid: false,
      containerPort,
      host: expectedHost,
      hostPort,
      bindings,
      diagnostic: `Docker published host port ${hostPort} on ${matchingPort
        .map((binding) => binding.host)
        .join(', ')}, not the expected interface ${expectedHost}.`
    }
  }
}

function normalizeHost(host) {
  return String(host || '0.0.0.0').trim() || '0.0.0.0'
}

function hostMatches(expected, actual) {
  if (expected === '0.0.0.0') {
    return actual === '0.0.0.0' || actual === '::'
  }

  return expected === actual
}

function describeBindings(bindings) {
  return bindings
    .map((binding) => `${binding.host}:${binding.port || 'unknown'}`)
    .join(', ')
}
