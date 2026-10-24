const { test } = require('sounding')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { createSessionCookie } = require('sounding/lib/create-session-cookie')
const { withCsrfFromPage } = require('../../support/csrf-request')
const contract = require('../../../packages/cli/src/lib/ci-contract.cjs')

test(
  'trusted local CI binds policy, source, signature and one-use challenge and rejects replay tampering and revocation',
  {
    transport: 'http',
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-trusted-owner' } }
    }
  },
  async ({ sails, world, request, expect }) => {
    const app = world.current.apps.web,
      project = world.current.projects.deploymentTarget
    const cookie = await createSessionCookie(sails, {
      userId: world.current.users.genesisUser.id
    })
    const browser = await withCsrfFromPage(request.withHeaders({ cookie }), '/')
    const base = `/api/v1/projects/${project.slug}/environments/production/apps/${app.slug}/ci`
    const source = {
      repositoryId: '1234',
      repositoryName: 'fixture/app',
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
      branch: 'main',
      manifest: {
        scripts: {
          lint: 'prettier --check .',
          test: 'node --test',
          build: 'node build.js'
        }
      },
      manifestDigest: 'sha256:' + 'c'.repeat(64),
      lockDigest: 'sha256:' + 'd'.repeat(64)
    }
    const previous = sails.helpers.ci.resolveSource
    const resolve = async () => source
    resolve.with = resolve
    sails.helpers.ci.resolveSource = resolve
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
    try {
      const configured = await browser.request.post(base + '/policy', {
        commit: source.commit,
        branch: 'main',
        image: 'node@sha256:' + 'e'.repeat(64),
        platform: 'linux/amd64',
        approvePolicy: true,
        enabled: true
      })
      expect(configured).toHaveStatus(200)
      const policy = configured.data.policy
      const approved = await browser.request.post(base + '/approve-runner', {
        name: 'Reviewed local device',
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
        policyRevision: policy.revision,
        trustDevice: true
      })
      expect(approved).toHaveStatus(200)
      const runnerId = approved.data.runner.runnerId
      const repeatedApproval = await browser.request.post(
        base + '/approve-runner',
        {
          name: 'Reviewed local device',
          publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
          policyRevision: policy.revision,
          trustDevice: true
        }
      )
      expect(repeatedApproval).toHaveStatus(200)
      assert.equal(repeatedApproval.data.runner.runnerId, runnerId)
      assert.equal(await sails.models.cirunner.count({ app: app.id }), 1)

      const issued = await browser.request.post(base + '/challenge', {
        runnerId,
        commit: source.commit
      })
      expect(issued).toHaveStatus(200)
      const challenge = issued.data.challenge,
        now = Date.now()
      const report = {
        scope: 'source-checks-only',
        deployable: false,
        state: 'passed',
        sourceRevision: source.commit,
        manifestDigest: source.manifestDigest,
        lockDigest: source.lockDigest,
        configuration: policy.configuration.execution,
        configRevision: policy.configuration.configRevision,
        runtime: {
          image: policy.configuration.execution.runtime,
          architecture: 'amd64',
          node: 'v22.23.4',
          imageId: 'sha256:' + 'e'.repeat(64)
        },
        cleanup: { state: 'completed' },
        checkNetwork: 'disconnected',
        startedAt: new Date(now - 1000).toISOString(),
        finishedAt: new Date(now).toISOString(),
        durationSeconds: 1,
        steps: ['install', 'lint', 'test', 'build'].map((name) => ({
          name,
          state: 'passed',
          durationSeconds: 0.2,
          exitCode: 0
        }))
      }
      const sign = (challenge, value) =>
        crypto
          .sign(
            null,
            Buffer.from(
              contract.canonical(contract.statement(challenge, value))
            ),
            privateKey
          )
          .toString('base64url')
      const signature = sign(challenge, report)
      expect(
        await browser.request.post(base + '/receipt', {
          runnerId,
          runId: challenge.runId,
          report: { ...report, sourceRevision: 'f'.repeat(40) },
          signature
        })
      ).toHaveStatus(400)
      expect(
        await browser.request.post(base + '/receipt', {
          runnerId,
          runId: challenge.runId,
          report,
          signature: 'A'.repeat(86)
        })
      ).toHaveStatus(400)
      const accepted = await browser.request.post(base + '/receipt', {
        runnerId,
        runId: challenge.runId,
        report,
        signature
      })
      expect(accepted).toHaveStatus(200)
      assert.equal(accepted.data.run.state, 'passed')
      assert.equal(accepted.data.run.deployable, false)
      assert.equal(
        (
          await browser.request.post(base + '/receipt', {
            runnerId,
            runId: challenge.runId,
            report,
            signature
          })
        ).data.reused,
        true
      )
      const next = (
        await browser.request.post(base + '/challenge', {
          runnerId,
          commit: source.commit
        })
      ).data.challenge
      expect(
        await browser.request.post(base + '/receipt', {
          runnerId,
          runId: next.runId,
          report,
          signature
        })
      ).toHaveStatus(400)
      const partial = { ...report, steps: report.steps.slice(0, 3) }
      expect(
        await browser.request.post(base + '/receipt', {
          runnerId,
          runId: next.runId,
          report: partial,
          signature: sign(next, partial)
        })
      ).toHaveStatus(400)
      const wrongArchitecture = {
        ...report,
        runtime: { ...report.runtime, architecture: 'arm64' }
      }
      expect(
        await browser.request.post(base + '/receipt', {
          runnerId,
          runId: next.runId,
          report: wrongArchitecture,
          signature: sign(next, wrongArchitecture)
        })
      ).toHaveStatus(400)
      await assert.rejects(
        sails.helpers.ci.verifyLocalReceipt.with({
          challenge: next,
          runner: await sails.models.cirunner.findOne({ runnerId }),
          policy,
          report,
          signature: sign(next, report),
          now: next.expiresAt + 1
        }),
        /invalid, expired/
      )
      const outstanding = await sails.models.cirun.count({
        app: app.id,
        state: 'pending'
      })
      for (let index = outstanding; index < 10; index++)
        expect(
          await browser.request.post(base + '/challenge', {
            runnerId,
            commit: source.commit
          })
        ).toHaveStatus(200)
      expect(
        await browser.request.post(base + '/challenge', {
          runnerId,
          commit: source.commit
        })
      ).toHaveStatus(400)
      expect(
        await browser.request.post(base + '/revoke-runner', { runnerId })
      ).toHaveStatus(200)
      expect(
        await browser.request.post(base + '/receipt', {
          runnerId,
          runId: next.runId,
          report,
          signature: sign(next, report)
        })
      ).toHaveStatus(400)
      assert.equal(
        await sails.models.cirun.count({ app: app.id, state: 'passed' }),
        1
      )
      const otherApp = await sails.models.app
        .create({
          name: 'Other app',
          slug: 'other-ci-app',
          environment: app.environment
        })
        .fetch()
      expect(
        await browser.request.post(
          base.replace(`/apps/${app.slug}/`, `/apps/${otherApp.slug}/`) +
            '/receipt',
          { runnerId, runId: challenge.runId, report, signature }
        )
      ).toHaveStatus(400)
      const member = await world.create('user').with({
        email: 'ci-member@example.test',
        team: project.team,
        teamRole: 'member'
      })
      const memberCookie = await createSessionCookie(sails, {
        userId: member.id
      })
      const memberBrowser = await withCsrfFromPage(
        request.withHeaders({ cookie: memberCookie }),
        '/'
      )
      expect(
        await memberBrowser.request.post(base + '/policy', {
          enabled: false,
          approvePolicy: true,
          policyRevision: policy.revision
        })
      ).toHaveStatus(403)
      const forbidden = await browser.request.post(
        base.replace(app.slug, 'missing-app') + '/challenge',
        { runnerId, commit: source.commit }
      )
      expect(forbidden).toHaveStatus(403)
    } finally {
      sails.helpers.ci.resolveSource = previous
    }
  }
)
