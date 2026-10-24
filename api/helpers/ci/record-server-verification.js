const { execFile } = require('node:child_process')
const command = require('node:util').promisify(execFile)
module.exports = {
  friendlyName: 'Record server deployment verification',
  description:
    'Record the server health-checked immutable candidate separately from local source evidence.',
  inputs: {
    admission: { type: 'ref', required: true },
    deploymentId: { type: 'string', required: true },
    contextPath: { type: 'string', required: true },
    containerName: { type: 'string', required: true },
    imageId: { type: 'string', required: true },
    runtimeRevision: { type: 'string', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    admission,
    deploymentId,
    contextPath,
    containerName,
    imageId,
    runtimeRevision
  }) {
    if (!admission.required) return null
    const current = await sails.helpers.ci.getDeploymentAdmission.with({
      appId: admission.appId,
      contextPath,
      expectedPolicyRevision: admission.policyRevision
    })
    if (
      !current.allowed ||
      current.runId !== admission.runId ||
      !/^sha256:[a-f0-9]{64}$/.test(imageId) ||
      !/^slipway-[a-z0-9-]+$/.test(containerName)
    )
      throw new Error('Source verification changed before candidate promotion.')
    const policy = await CiPolicy.findOne({ app: admission.appId })
    const localRun = await CiRun.findOne({
      id: admission.runId,
      app: admission.appId
    })
    const docker = sails.config.docker?.binaryPath || 'docker'
    const execute = async (args, timeout = 15000, maxBuffer = 65536) => {
      try {
        return (
          await command(docker, args, { timeout, maxBuffer })
        ).stdout.trim()
      } catch {
        throw new Error(
          'The server could not verify the candidate runtime and image identity.'
        )
      }
    }
    if (
      (await execute([
        'container',
        'inspect',
        '--format',
        '{{.Image}}',
        containerName
      ])) !== imageId
    )
      throw new Error(
        'The health-checked container does not use the verified immutable image.'
      )
    const nodeVersion = await execute(
      ['exec', containerName, 'node', '--version'],
      15000,
      512
    )
    if (nodeVersion !== localRun?.summary?.runtime?.node)
      throw new Error(
        'The deployment Node version differs from the trusted local CI runtime.'
      )
    const runtime = policy.configuration.execution.runtime
    // Pull only the owner-reviewed immutable official Node runtime when it is not cached.
    let base
    try {
      base = JSON.parse(
        await execute([
          'image',
          'inspect',
          '--format',
          '{{json .RootFS.Layers}}',
          runtime
        ])
      )
    } catch {
      await execute(
        ['pull', '--platform', admission.platform, runtime],
        180000,
        1048576
      )
      base = JSON.parse(
        await execute([
          'image',
          'inspect',
          '--format',
          '{{json .RootFS.Layers}}',
          runtime
        ])
      )
    }
    const layers = JSON.parse(
      await execute([
        'image',
        'inspect',
        '--format',
        '{{json .RootFS.Layers}}',
        imageId
      ])
    )
    if (
      !Array.isArray(base) ||
      !base.length ||
      !Array.isArray(layers) ||
      base.some(
        (layer, index) =>
          !/^sha256:[a-f0-9]{64}$/.test(layer) || layers[index] !== layer
      )
    )
      throw new Error(
        'The server image is not based on the reviewed CI runtime. Pin the Dockerfile base and CI runtime together.'
      )
    const verification = await CiVerification.create({
      deployment: deploymentId,
      app: admission.appId,
      run: admission.runId,
      policyRevision: admission.policyRevision,
      imageId,
      commit: admission.commit,
      runtimeRevision,
      verifiedAt: Date.now()
    }).fetch()
    return {
      verificationId: String(verification.id),
      ...admission,
      imageId,
      runtimeRevision
    }
  }
}
