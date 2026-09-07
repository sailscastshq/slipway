const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { randomUUID } = require('node:crypto')
const exec = promisify(execFile)

module.exports = {
  friendlyName: 'Update dashboard route',
  description:
    'Verify a dashboard route candidate before retiring the working route.',
  inputs: {
    domain: { type: 'string', required: true },
    acmeEmail: { type: 'string' },
    deferCommit: { type: 'boolean', defaultsTo: false }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ domain, acmeEmail, deferCommit }) {
    const docker = sails.config.docker?.binaryPath || 'docker'
    const network = sails.config.custom.slipwayNetwork || 'slipway'
    const routeId = 'slipway-route-dashboard'
    const suffix = randomUUID()
    const candidateRouteId = `${routeId}-candidate-${suffix}`
    const previousRouteId = `${routeId}-previous-${suffix}`
    const upstream = `${
      sails.config.custom.slipwayContainerName || 'slipway'
    }:${sails.config.port || 1337}`
    const run = (args) => exec(docker, args, { timeout: 30000 })
    let previousExists = false
    let previousWasRunning = false
    try {
      const state = await run([
        'inspect',
        '--format',
        '{{.State.Running}}',
        routeId
      ])
      previousExists = true
      previousWasRunning = state.stdout.trim() === 'true'
    } catch (error) {
      if (
        !/no such (object|container)/i.test(error.stderr || error.message || '')
      )
        throw error
    }
    const oldDomain = await sails.helpers.setting.get('instanceDomain')
    const siteLabel = await sails.helpers.caddy.formatSiteLabel.with({
      domains: [domain]
    })
    const email =
      acmeEmail === undefined
        ? await sails.helpers.setting.get('acmeEmail')
        : acmeEmail
    const args = [
      'run',
      '-d',
      '--name',
      candidateRouteId,
      '--network',
      network,
      '--restart',
      'unless-stopped',
      '--label',
      `caddy=${siteLabel}`,
      '--label',
      `caddy.reverse_proxy=${upstream}`
    ]
    if (email && sails.config.custom.slipwayIngress !== 'cloudflare-tunnel')
      args.push('--label', `caddy.tls=${email}`)
    args.push('alpine', 'sleep', 'infinity')
    const transaction = {
      routeId,
      candidateRouteId,
      previousRouteId,
      previousExists,
      previousWasRunning,
      previousUpstreams: previousExists ? [upstream] : [],
      candidateUpstreams: [upstream],
      previousDomains: previousExists && oldDomain ? [oldDomain] : [],
      candidateDomains: [domain]
    }
    try {
      await run(args)
      await sails.helpers.caddy.verifyRoute.with({
        expectedUpstreams: [upstream],
        expectedDomains: [domain]
      })
      if (!deferCommit) {
        await sails.helpers.caddy.finishRouteUpdate.with({
          action: 'commit',
          transaction
        })
        await run(['rm', '-f', 'slipway-route-bootstrap']).catch(() => {})
      }
      return {
        domain,
        action: previousExists ? 'replaced' : 'created',
        transaction
      }
    } catch (error) {
      await run(['rm', '-f', candidateRouteId]).catch(() => {})
      throw error
    }
  }
}
