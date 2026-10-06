const { execFile } = require('node:child_process')
const execute = require('node:util').promisify(execFile)
const brokerFactory = require('./upgrade-broker')
async function broker(req) {
  const actor = req.auth?.userId
    ? await User.findOne({ id: req.auth.userId })
    : null
  return brokerFactory({ actor })
}
async function advertised() {
  const update = await sails.helpers.system.checkForUpdates()
  if (!update.updateAvailable)
    throw Object.assign(new Error('No update is available.'), {
      code: 'upgradeNoUpdate'
    })
  const tag = await sails.helpers.system.getUpdateImageRef.with({
    updateInfo: update,
    imageRepository: 'ghcr.io/sailscastshq/slipway'
  })
  if (!/^ghcr\.io\/sailscastshq\/slipway:\d+\.\d+\.\d+$/.test(tag))
    throw Object.assign(new Error('Pinned release required.'), {
      code: 'upgradeHostImage'
    })
  await execute(sails.config.docker?.binaryPath || 'docker', ['pull', tag], {
    timeout: 300000,
    maxBuffer: 65536
  })
  const inspected = await require('./upgrade-docker-api')()(
    'GET',
    `/images/${encodeURIComponent(tag)}/json`
  )
  const image = (inspected.RepoDigests || []).find((value) =>
    /^ghcr\.io\/sailscastshq\/slipway@sha256:[a-f0-9]{64}$/.test(value)
  )
  if (!image)
    throw Object.assign(new Error('Pinned release required.'), {
      code: 'upgradeHostImage'
    })

  return image
}
function failure(res, error, req) {
  const code = /^upgrade[A-Za-z]+$/.test(error.code || '')
    ? error.code
    : 'upgradeDispatchUnconfirmed'
  const status =
    code === 'upgradeHandoffRejected'
      ? 403
      : [
          'upgradeHostApproval',
          'upgradeHostRequired',
          'upgradeNoUpdate',
          'upgradeHostTarget'
        ].includes(code)
      ? 409
      : 503
  const message =
    code === 'upgradeHostRequired'
      ? 'This installation requires the one-time host upgrade command.'
      : 'Upgrade was not confirmed. Inspect the saved checkpoint before retrying.'
  if (req?.get('X-Inertia')) {
    req.session.errors = { approval: message }
    return res.status(303).set('Location', '/settings/update').send('See Other')
  }
  return res.status(status).json({
    success: false,
    code,
    message
  })
}
async function action(method, context, inputs, dependencies = {}) {
  const { req, res } = context
  try {
    // The approved first slice has no persistent privileged UI transport.
    // Only explicit trusted compatibility tests can exercise the old broker.
    if (!dependencies.allowContainerDispatch) {
      const host = require('./upgrade-host-review')
      if (method === 'plan')
        return host.review(await (dependencies.advertised || advertised)())
      if (method === 'latest')
        return host.status() || { status: 'idle', execution: 'host-native' }
      if (method === 'status')
        return (
          host.status(inputs.id) || { status: 'idle', execution: 'host-native' }
        )
      throw Object.assign(new Error('Run the reviewed host command.'), {
        code: 'upgradeHostRequired'
      })
    }
    const client = await (dependencies.broker || broker)(req)
    if (method === 'plan')
      return await client.plan(await (dependencies.advertised || advertised)())
    if (method === 'status') return client.status(inputs.id)
    if (method === 'latest') return client.latest() || { status: 'idle' }
    const accepted =
      method === 'apply'
        ? await client.apply({
            image: await (dependencies.advertised || advertised)(),
            approval: inputs.approval,
            requestedInstance: inputs.instanceId
          })
        : await client.resume(inputs.id, {
            approval: inputs.approval,
            requestedInstance: inputs.instanceId
          })
    // Inertia must receive its redirected page and durable receipt before the
    // source stops. The view starts the saved helper after that page is flushed.
    const inertia = Boolean(req.get('X-Inertia'))
    let finished = false
    res.once('finish', () => {
      finished = true
      if (inertia) return
      accepted
        .start()
        .catch(() =>
          sails.log.error(
            'Upgrade dispatch outcome is unconfirmed; inspect the saved checkpoint.'
          )
        )
    })
    res.once('close', () => {
      if (!finished) accepted.cancel().catch(() => {})
    })
    if (inertia)
      return res
        .status(303)
        .set('Location', `/settings/update?upgradeId=${accepted.result.id}`)
        .send('See Other')
    return res.status(202).json(accepted.result)
  } catch (error) {
    return failure(res, error, req)
  }
}
module.exports = { action, broker, failure }
