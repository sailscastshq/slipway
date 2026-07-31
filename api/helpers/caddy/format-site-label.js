module.exports = {
  friendlyName: 'Format Caddy site label',

  description:
    'Format hostnames for public TLS ingress or private Cloudflare Tunnel ingress.',

  inputs: {
    domains: {
      type: 'ref',
      required: true,
      description: 'Hostnames Caddy should route.'
    }
  },

  exits: {
    success: {
      outputType: 'string'
    }
  },

  fn: async function ({ domains }) {
    const normalizedDomains = (domains || [])
      .map((domain) => String(domain || '').trim())
      .filter(Boolean)

    if (sails.config.custom.slipwayIngress === 'cloudflare-tunnel') {
      return normalizedDomains.map((domain) => `http://${domain}`).join(',')
    }

    return normalizedDomains.join(',')
  }
}
