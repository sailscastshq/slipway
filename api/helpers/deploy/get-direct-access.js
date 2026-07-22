module.exports = {
  friendlyName: 'Get direct access',

  description:
    'Describe a routable app direct endpoint only when its live Docker mapping is valid.',

  inputs: {
    serverIp: {
      type: 'string',
      required: true
    },
    hostPort: {
      type: 'number',
      required: true
    },
    routePath: {
      type: 'string',
      allowNull: true
    },
    containerRunning: {
      type: 'boolean',
      defaultsTo: true
    },
    portBinding: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  fn: async function ({
    serverIp,
    hostPort,
    routePath,
    containerRunning,
    portBinding
  }) {
    if (routePath === null) {
      return {
        url: null,
        attemptedUrl: null,
        status: 'not-routable',
        message: null,
        firewallHint: null
      }
    }

    const attemptedUrl = `http://${formatHostname(serverIp)}:${hostPort}`
    const firewallHint = `If this URL times out, allow inbound TCP ${hostPort} in both the VPS provider firewall and any active host firewall.`

    if (!containerRunning) {
      return {
        url: null,
        attemptedUrl,
        status: 'unavailable',
        message: 'Direct access is unavailable because the app is not running.',
        firewallHint
      }
    }

    if (!portBinding || portBinding.valid !== true) {
      return {
        url: null,
        attemptedUrl,
        status: 'unavailable',
        message:
          portBinding?.diagnostic ||
          `Slipway could not verify Docker's host port ${hostPort} mapping. Redeploy the app and check the deployment logs.`,
        firewallHint
      }
    }

    if (isLoopback(portBinding.host)) {
      return {
        url: null,
        attemptedUrl,
        status: 'unavailable',
        message: `Docker published host port ${hostPort} only on ${portBinding.host}, so it is intentionally private. Bind routable apps to 0.0.0.0 and redeploy before using a public direct URL.`,
        firewallHint
      }
    }

    return {
      url: attemptedUrl,
      attemptedUrl,
      status: 'published',
      message: null,
      firewallHint,
      binding: portBinding
    }
  }
}

function formatHostname(hostname) {
  const normalized = String(hostname || '').trim()

  return normalized.includes(':') && !normalized.startsWith('[')
    ? `[${normalized}]`
    : normalized
}

function isLoopback(hostname) {
  const normalized = String(hostname || '')
    .trim()
    .toLowerCase()

  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  )
}
