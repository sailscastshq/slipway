const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')
const contract = require('../../../../packages/cli/src/lib/ci-contract.cjs')

test(
  'server admission binds the clean Git tree and promotion rechecks revocation, policy and immutable image inside the transaction',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-server-gate' } }
    }
  },
  async ({ sails, world }) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ci-server-gate-')
    )
    const previousDocker = sails.config.docker
    try {
      const app = world.current.apps.web
      const owner = world.current.users.genesisUser
      const manifest = JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        scripts: {
          lint: 'node lint.js',
          test: 'node --test',
          build: 'node build.js'
        }
      })
      const lock = JSON.stringify({
        name: 'fixture',
        version: '1.0.0',
        lockfileVersion: 3
      })
      await fs.writeFile(path.join(directory, 'package.json'), manifest)
      await fs.writeFile(path.join(directory, 'package-lock.json'), lock)
      const git = (...args) =>
        execFileSync('git', ['-C', directory, ...args], {
          encoding: 'utf8'
        }).trim()
      git('init', '-q')
      git('add', '.')
      git(
        '-c',
        'user.name=CI fixture',
        '-c',
        'user.email=ci@example.test',
        'commit',
        '-qm',
        'test(ci): seed fixture'
      )
      const commit = git('rev-parse', 'HEAD'),
        tree = git('rev-parse', 'HEAD^{tree}')
      const imageId = 'sha256:' + 'a'.repeat(64),
        base = 'sha256:' + 'b'.repeat(64)
      const execution = contract.configuration(
        JSON.parse(manifest),
        'node@sha256:' + 'c'.repeat(64),
        'linux/amd64'
      )
      const policy = await sails.models.cipolicy
        .create({
          app: app.id,
          revision: 'policy-1',
          repositoryId: '123',
          branch: 'main',
          createdBy: owner.id,
          enabled: true,
          configuration: {
            execution,
            configRevision: contract.digest(execution),
            serverVerification: 'ci-server-verification-v1'
          }
        })
        .fetch()
      const provider = await sails.models.gitprovider
        .create({ type: 'github', name: 'CI fixture', team: owner.team })
        .fetch()
      await sails.models.gitrepository.create({
        provider: provider.id,
        app: app.id,
        environment: app.environment,
        externalId: '123',
        fullName: 'fixture/app',
        name: 'app',
        owner: 'fixture',
        cloneUrl: 'https://github.com/fixture/app.git'
      })
      const runner = await sails.models.cirunner
        .create({
          app: app.id,
          runnerId: crypto.randomUUID(),
          name: 'Trusted device',
          publicKey: 'fixture',
          policyRevision: policy.revision,
          approvedBy: owner.id
        })
        .fetch()
      const run = await sails.models.cirun
        .create({
          app: app.id,
          runner: runner.id,
          runId: crypto.randomUUID(),
          policyRevision: policy.revision,
          commit,
          challenge: {
            tree,
            manifestDigest: contract.digest(manifest),
            lockDigest: contract.digest(lock)
          },
          expiresAt: Date.now() + 300000,
          state: 'passed',
          completedAt: Date.now(),
          summary: {
            finishedAt: Date.now(),
            scope: 'source-checks-only',
            deployable: false,
            runtime: { node: 'v22.23.4' }
          }
        })
        .fetch()
      const admission = await sails.helpers.ci.getDeploymentAdmission.with({
        appId: app.id,
        contextPath: directory
      })
      assert.equal(admission.allowed, true)
      assert.equal(admission.runId, String(run.id))
      await fs.writeFile(path.join(directory, 'untracked.js'), 'extra')
      await assert.rejects(
        sails.helpers.ci.getDeploymentAdmission.with({
          appId: app.id,
          contextPath: directory
        }),
        /differs from its committed source/
      )
      await fs.unlink(path.join(directory, 'untracked.js'))
      const deployment = await world.create('deployment').with({
        app: app.id,
        environment: app.environment,
        status: 'deploying',
        imageId
      })
      // Fixed-command daemon fixture: candidate identity, executable version and OCI base chain.
      const docker = path.join(
        directory,
        '..',
        `ci-docker-${crypto.randomUUID()}`
      )
      await fs.writeFile(
        docker,
        `#!/usr/bin/env node\nconst a=process.argv.slice(2); if(a[0]==='container') console.log('${imageId}'); else if(a[0]==='exec') console.log('v22.23.4'); else console.log(JSON.stringify(a.at(-1)==='${imageId}' ? ['${base}', '${imageId}'] : ['${base}']));\n`,
        { mode: 0o700 }
      )
      sails.config.docker = { ...previousDocker, binaryPath: docker }
      try {
        const approval = await sails.helpers.ci.recordServerVerification.with({
          admission,
          deploymentId: deployment.id,
          contextPath: directory,
          containerName: 'slipway-ci-candidate',
          imageId,
          runtimeRevision: 'runtime-1'
        })
        const check = (image = imageId) =>
          sails.models.app.getDatastore().transaction((connection) =>
            sails.helpers.ci.assertCutover.with({
              approval,
              appId: app.id,
              deploymentId: deployment.id,
              imageId: image,
              connection
            })
          )
        await check()
        await assert.rejects(
          check('sha256:' + 'd'.repeat(64)),
          /changed before traffic commit/
        )
        await sails.models.cirunner
          .updateOne({ id: runner.id })
          .set({ revokedAt: Date.now() })
        await assert.rejects(check(), /changed before traffic commit/)
        const blocked = await sails.helpers.ci.getDeploymentAdmission.with({
          appId: app.id,
          contextPath: directory
        })
        assert.equal(blocked.allowed, false)
        await sails.models.cirunner
          .updateOne({ id: runner.id })
          .set({ revokedAt: null })
        await sails.models.cipolicy
          .updateOne({ id: policy.id })
          .set({ revision: 'policy-2' })
        await assert.rejects(check(), /changed before traffic commit/)
        await assert.rejects(
          sails.helpers.ci.getDeploymentAdmission.with({
            appId: app.id,
            contextPath: directory,
            expectedPolicyRevision: policy.revision
          }),
          /policy changed/
        )
      } finally {
        await fs.rm(docker, { force: true })
      }
    } finally {
      sails.config.docker = previousDocker
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)

test(
  'CI wait cancellation keeps the deployment cancellation classification',
  {
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-cancel-wait' } }
    }
  },
  async ({ sails, world }) => {
    const controller = new AbortController()
    controller.abort('Owner cancelled')
    await assert.rejects(
      sails.helpers.ci.awaitDeploymentAdmission.with({
        appId: world.current.apps.web.id,
        contextPath: '/unused',
        deploymentId: '1',
        signal: controller.signal
      }),
      (error) =>
        error.code === 'DEPLOYMENT_CANCELLED' ||
        error.cause?.code === 'DEPLOYMENT_CANCELLED'
    )
  }
)

test(
  'real Docker candidate passes health and runtime verification and a different immutable image is rejected',
  {
    skip: process.env.SLIPWAY_CI_DOCKER_TEST !== '1',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-real-candidate' } }
    }
  },
  async ({ sails, world }) => {
    const { promisify } = require('node:util')
    const execute = promisify(require('node:child_process').execFile)
    const docker = async (...args) =>
      (
        await execute('docker', args, { timeout: 180000, maxBuffer: 1048576 })
      ).stdout.trim()
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'ci-real-docker-')
    )
    const name = 'slipway-ci-verification-' + crypto.randomUUID()
    const tag = 'slipway/ci-verification:' + Date.now()
    const previous = sails.helpers.ci.getDeploymentAdmission
    const runtime =
      'node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09'
    let imageId
    try {
      await fs.writeFile(
        path.join(directory, 'Dockerfile'),
        `FROM ${runtime}\nUSER node\nEXPOSE 1337\nCMD ["node", "-e", "require('http').createServer((q,s)=>s.end('ok')).listen(1337);setTimeout(()=>process.exit(),180000)"]\n`
      )
      await docker('build', '--platform', 'linux/amd64', '-t', tag, directory)
      imageId = await docker('image', 'inspect', '--format', '{{.Id}}', tag)
      await docker(
        'run',
        '-d',
        '--name',
        name,
        '--platform',
        'linux/amd64',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        '256m',
        '-p',
        '127.0.0.1::1337',
        imageId
      )
      const bindings = JSON.parse(
        await docker(
          'container',
          'inspect',
          '--format',
          '{{json .NetworkSettings.Ports}}',
          name
        )
      )
      await sails.helpers.docker.healthCheck.with({
        containerName: name,
        port: 1337,
        hostPort: Number(bindings['1337/tcp'][0].HostPort),
        path: '/health',
        timeout: 15000,
        interval: 100
      })
      const app = world.current.apps.web
      await sails.models.cipolicy.create({
        app: app.id,
        revision: 'real-policy',
        repositoryId: '123',
        branch: 'main',
        enabled: true,
        createdBy: world.current.users.genesisUser.id,
        configuration: { execution: { runtime } }
      })
      const runner = await sails.models.cirunner
        .create({
          app: app.id,
          runnerId: crypto.randomUUID(),
          name: 'Fixture',
          publicKey: 'fixture',
          policyRevision: 'real-policy',
          approvedBy: world.current.users.genesisUser.id
        })
        .fetch()
      const run = await sails.models.cirun
        .create({
          app: app.id,
          runner: runner.id,
          runId: crypto.randomUUID(),
          policyRevision: 'real-policy',
          commit: 'a'.repeat(40),
          challenge: {},
          expiresAt: Date.now() + 300000,
          state: 'passed',
          summary: { runtime: { node: 'v22.23.4' } }
        })
        .fetch()
      const deployment = await world.create('deployment').with({
        app: app.id,
        environment: app.environment,
        status: 'deploying',
        imageId
      })
      const admission = {
        required: true,
        allowed: true,
        appId: String(app.id),
        runId: String(run.id),
        runnerId: String(runner.id),
        policyRevision: 'real-policy',
        commit: 'a'.repeat(40),
        platform: 'linux/amd64'
      }
      const sourceAdmission = async () => admission
      sourceAdmission.with = sourceAdmission
      sails.helpers.ci.getDeploymentAdmission = sourceAdmission
      const input = {
        admission,
        deploymentId: deployment.id,
        contextPath: directory,
        containerName: name,
        imageId,
        runtimeRevision: 'fixture-runtime'
      }
      assert.equal(
        (await sails.helpers.ci.recordServerVerification.with(input)).imageId,
        imageId
      )
      await assert.rejects(
        sails.helpers.ci.recordServerVerification.with({
          ...input,
          imageId: 'sha256:' + 'd'.repeat(64)
        }),
        /does not use the verified immutable image/
      )
    } finally {
      sails.helpers.ci.getDeploymentAdmission = previous
      await docker('rm', '-f', name).catch(() => {})
      await docker('image', 'rm', tag).catch(() => {})
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
)
