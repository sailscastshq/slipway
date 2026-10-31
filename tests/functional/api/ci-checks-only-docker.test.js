const { test } = require('sounding')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const contract = require('../../../api/lib/contracts/ci-contract')
const github = require('../../../api/lib/ci-github')

test(
  'real checks-only worker executes exact synthetic source in the isolated server profile and retains a non-deployable receipt',
  {
    skip: process.env.CI_CHECKS_ONLY_DOCKER !== '1',
    timeout: 600000,
    world: {
      name: 'configured-slipway',
      context: { deploymentTarget: { slug: 'ci-real-worker' } }
    }
  },
  async ({ sails, world }) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'ci-worker-source-')
    )
    const app = world.current.apps.web
    const image =
      'node@sha256:ea11b74b986d520137cdef9a5346e447a00f275ecc4abc0055b7151226231e09'
    const previous = {
      source: sails.helpers.ci.resolveSource,
      pr: sails.helpers.ci.resolvePullRequest,
      clone: sails.helpers.git.cloneOrPull,
      connection: github.connection
    }
    const git = (...args) =>
      execFileSync('git', ['-C', directory, ...args], {
        encoding: 'utf8',
        timeout: 30000
      }).trim()
    try {
      const manifest = {
        name: 'ci-worker-synthetic-proof',
        version: '1.0.0',
        scripts: {
          postinstall: 'node install.cjs',
          lint: 'node stage.cjs lint',
          test: 'node stage.cjs test',
          build: 'node stage.cjs build'
        }
      }
      const lock = {
        name: manifest.name,
        version: manifest.version,
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': {
            name: manifest.name,
            version: manifest.version,
            hasInstallScript: true
          }
        }
      }
      const manifestText = JSON.stringify(manifest),
        lockText = JSON.stringify(lock)
      fs.writeFileSync(path.join(directory, 'package.json'), manifestText)
      fs.writeFileSync(path.join(directory, 'package-lock.json'), lockText)
      fs.writeFileSync(
        path.join(directory, 'install.cjs'),
        `require('node:fs').writeFileSync('installed', 'yes')`
      )
      fs.writeFileSync(
        path.join(directory, 'stage.cjs'),
        `const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os');assert.equal(process.platform,'linux');assert.equal(process.getuid(),1000);assert.ok(fs.existsSync('installed'));assert.deepEqual(Object.keys(os.networkInterfaces()).filter(n=>n!=='lo'),[]);assert.throws(()=>fs.writeFileSync('/ci-write-forbidden','no'),/EROFS|EACCES/);const stage=process.argv[2];if(stage==='test')assert.ok(fs.existsSync('lint-passed'));if(stage==='build')assert.ok(fs.existsSync('test-passed'));fs.writeFileSync(stage+'-passed','yes')`
      )
      git('init', '-q', '-b', 'feat/ci-worker-source')
      git('add', '.')
      git(
        '-c',
        'user.name=CI fixture',
        '-c',
        'user.email=ci@example.test',
        'commit',
        '-qm',
        'test: verify checks-only worker'
      )
      const source = {
        repositoryId: '123',
        repositoryName: 'fixture/source',
        commit: git('rev-parse', 'HEAD'),
        tree: git('rev-parse', 'HEAD^{tree}'),
        branch: 'feat/ci-worker-source',
        manifest,
        manifestDigest: contract.digest(manifestText),
        lockDigest: contract.digest(lockText)
      }
      const execution = contract.configuration(manifest, image, 'linux/amd64')
      const policy = await sails.models.cipolicy
        .create({
          app: app.id,
          createdBy: world.current.users.genesisUser.id,
          revision: 'synthetic-worker-policy',
          enabled: true,
          repositoryId: '123',
          branch: 'main',
          configuration: {
            pullRequests: true,
            automatic: false,
            execution,
            configRevision: contract.digest(execution)
          }
        })
        .fetch()
      const resolve = async () => source
      resolve.with = resolve
      sails.helpers.ci.resolveSource = resolve
      sails.helpers.ci.resolvePullRequest = resolve
      const clone = async ({ targetDir }) => {
        execFileSync(
          'git',
          ['clone', '--no-hardlinks', '--quiet', directory, targetDir],
          { timeout: 30000 }
        )
      }
      clone.with = clone
      sails.helpers.git.cloneOrPull = clone
      let reported
      github.connection = async () => ({
        repository: {
          externalId: '123',
          cloneUrl: 'synthetic-fixture',
          deployKeyPrivate: null
        },
        project: world.current.projects.deploymentTarget,
        environment: { slug: 'production' },
        request: async (suffix, options = {}) => {
          if (!suffix) return { id: 123 }
          assert.equal(suffix, '/statuses/' + source.commit)
          reported = options.body
          return { id: 12345 }
        }
      })
      const job = await sails.helpers.ci.queueChecks.with({
        appId: String(app.id),
        pullRequest: 7
      })
      await sails.helpers.ci.runQueuedChecks()
      const completed = await sails.models.cijob.findOne({ jobId: job.id })
      const run =
        completed.run &&
        (await sails.models.cirun.findOne({ id: completed.run }))
      fs.writeFileSync(
        path.resolve('.tmp/ci-checks-only-proof.json'),
        JSON.stringify(
          {
            synthetic: true,
            jobId: completed.jobId,
            state: completed.state,
            reason: completed.reason,
            commit: completed.commit,
            runId: run?.runId,
            summary: run?.summary
          },
          null,
          2
        )
      )
      assert.equal(completed.state, 'passed', completed.reason)
      assert.equal(run.state, 'passed')
      assert.equal(run.commit, source.commit)
      assert.equal(run.challenge.purpose, 'checks-only-source-v1')
      assert.equal(run.summary.cleanup.state, 'completed')
      assert.equal(run.summary.serverProof.checkNetwork, 'disconnected')
      assert.equal(
        sails.helpers.ci.isServerEvidence.with({
          run,
          policy,
          checksOnly: true
        }),
        true
      )
      assert.equal(
        sails.helpers.ci.isServerEvidence.with({ run, policy }),
        false
      )
      assert.equal(reported.state, 'success')
      assert.equal(await sails.models.deployment.count(), 0)
    } finally {
      sails.helpers.ci.resolveSource = previous.source
      sails.helpers.ci.resolvePullRequest = previous.pr
      sails.helpers.git.cloneOrPull = previous.clone
      github.connection = previous.connection
      fs.rmSync(directory, { recursive: true, force: true })
    }
  }
)
