const withDatastoreTransaction = require('../../lib/with-datastore-transaction')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, execFile } = require('node:child_process')
const execute = require('node:util').promisify(execFile)
const contract = require('../../lib/contracts/ci-contract')
const { executorDigest } = require('./is-server-evidence')._private
const cancellation = require('../../lib/deployment-cancellation')
const retryObservation = require('../../lib/ci-datastore-retry')
module.exports = {
  friendlyName: 'Run isolated server CI checks',
  description:
    'Use the existing fenced deployment worker; no repository code runs on the management host.',
  inputs: {
    appId: { type: 'string', required: true },
    contextPath: { type: 'string', required: true },
    deploymentId: { type: 'string', required: true },
    leaseToken: { type: 'string' },
    policyRevision: { type: 'string', required: true },
    signal: { type: 'ref' }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({
    appId,
    contextPath,
    deploymentId,
    leaseToken,
    policyRevision,
    signal
  }) {
    const ensureOwner = async () => {
      cancellation.throwIfCancelled(signal, deploymentId)
      const lease = await sails.helpers.deploy.assertDeploymentLease.with({
        deploymentId,
        leaseToken
      })
      if (!lease.valid)
        throw new Error('The deployment no longer owns CI execution.')
      const policy = await CiPolicy.findOne({ app: appId })
      if (
        !policy?.enabled ||
        policy.revision !== policyRevision ||
        policy.configuration.automatic !== true
      )
        throw new Error(
          'The automatic CI policy changed. The current release is unchanged.'
        )
      return policy
    }
    const observeOwner = (deadline = Date.now() + 1500) =>
      retryObservation(ensureOwner, { signal, deadline })
    const policy = await observeOwner()
    const app = await App.findOne({ id: appId })
    const { stdout } = await execute(
      'git',
      ['-C', contextPath, 'rev-parse', 'HEAD'],
      { timeout: 15000 }
    )
    const source = await sails.helpers.ci.resolveSource.with({
      app,
      commit: stdout.trim(),
      branch: policy.branch
    })
    if (
      source.repositoryId !== policy.repositoryId ||
      contract.digest(
        contract.configuration(
          source.manifest,
          policy.configuration.execution.runtime,
          policy.configuration.execution.platform
        )
      ) !== policy.configuration.configRevision
    )
      throw new Error(
        'Review the changed source-check commands before automatic execution.'
      )
    // An uncertain or leaked CI container holds capacity. Never prune unrelated containers.
    const inventory = await execute(
      sails.config.docker?.binaryPath || 'docker',
      [
        'ps',
        '-a',
        '--filter',
        'label=slipway.ci.server',
        '--format',
        '{{.ID}}'
      ],
      { timeout: 15000, maxBuffer: 65536 }
    )
    if (inventory.stdout.trim()) return { busy: true }
    const runId = crypto.randomUUID(),
      now = Date.now()
    const summary = {
      id: runId,
      title: 'Required lint, tests and build',
      origin: 'server',
      state: 'preparing',
      sourceRevision: source.commit,
      scope: 'source-checks-only',
      deployable: false,
      steps: [],
      cleanup: { state: 'pending' },
      startedAt: now
    }
    const run = await sails.helpers.ci.reserveServerRun.with({
      appId,
      policy,
      source,
      runId,
      deploymentId,
      summary
    })
    if (!run) return { busy: true }
    let latestSummary = summary
    let directory
    try {
      await fs.mkdir(path.join(sails.config.appPath, '.tmp'), {
        recursive: true
      })
      directory = await fs.mkdtemp(
        path.join(sails.config.appPath, '.tmp/ci-server-')
      )
      await fs.chmod(directory, 0o700)
    } catch (error) {
      await CiRun.updateOne({ id: run.id, state: 'pending' }).set({
        state: 'failed',
        completedAt: Date.now(),
        summary: {
          ...summary,
          state: 'failed',
          reason: 'CI could not prepare its private workspace.'
        }
      })
      if (directory) await fs.rm(directory, { recursive: true, force: true })
      throw new Error(
        'CI could not prepare its private workspace; check instance storage permissions.'
      )
    }
    const output = path.join(directory, 'evidence'),
      container = `slipway-ci-server-${runId}`
    let child,
      timer,
      stop,
      checking = false,
      lastStage,
      report,
      executionError,
      killTimer,
      setupDiagnostic = ''
    const stage = async (name) => {
      if (name === lastStage) return
      const result = await sails.helpers.deploy.recordDeploymentStage.with({
        deploymentId,
        leaseToken,
        stage: name
      })
      if (!result.valid)
        throw new Error('The deployment no longer owns CI progress.')
      lastStage = name
    }
    const snapshot = async () => {
      try {
        const file = path.join(output, 'report.json'),
          stat = await fs.lstat(file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
          throw new Error('CI report exceeds its limit.')
        return JSON.parse(await fs.readFile(file, 'utf8'))
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) return null
        throw error
      }
    }
    const update = async (data) => {
      const steps = (data.steps || [])
        .slice(0, 4)
        .map(({ name, state, durationSeconds, exitCode, resources }) => ({
          name,
          state,
          durationSeconds,
          exitCode,
          resources
        }))
      const next = {
        ...summary,
        state: data.state,
        durationSeconds: data.durationSeconds,
        resources: data.resources,
        cache: data.cache,
        steps,
        runtime: data.runtime
          ? {
              image: data.runtime.image,
              imageId: data.runtime.imageId,
              architecture: data.runtime.architecture,
              node: data.runtime.node
            }
          : undefined,
        cleanup: { state: data.cleanup?.state || 'pending' }
      }
      await CiRun.updateOne({ id: run.id, state: 'pending' }).set({
        summary: next
      })
      latestSummary = next
      const active = steps.find((item) => item.state === 'running')
      await stage(
        active
          ? `ci_${active.name}`
          : data.state === 'passed'
          ? 'ci_cleanup'
          : 'ci_running'
      )
      return next
    }
    try {
      await observeOwner(now + 1260000)
      await stage('ci_running')
      await Deployment.appendBuildLog(
        deploymentId,
        'CI: no reusable local result; starting bounded server checks.\n'
      )
      const code = await new Promise((resolve, reject) => {
        child = spawn(
          process.execPath,
          [
            path.resolve(__dirname, '../../../bin/ci-server-executor.cjs'),
            '--cache-dir',
            path.join(sails.config.appPath, '.tmp/ci-package-cache'),
            '--cache-scope',
            crypto
              .createHash('sha256')
              .update(
                JSON.stringify([
                  appId,
                  policy.repositoryId,
                  policy.branch,
                  policy.revision
                ])
              )
              .digest('hex'),
            '--repo',
            contextPath,
            '--commit',
            source.commit,
            '--image',
            policy.configuration.execution.runtime,
            '--platform',
            policy.configuration.execution.platform,
            '--approve',
            'lint,test,build',
            '--approve-install',
            'yes',
            '--out',
            output,
            '--run-id',
            runId
          ],
          { stdio: ['ignore', 'ignore', 'pipe'] }
        )
        child.stderr.on('data', (chunk) => {
          setupDiagnostic = (setupDiagnostic + chunk.toString('utf8')).slice(
            -4096
          )
        })
        stop = () => {
          child.kill('SIGTERM')
          killTimer ||= setTimeout(() => child.kill('SIGKILL'), 10000)
        }
        signal?.addEventListener('abort', stop, { once: true })
        if (signal?.aborted) stop()
        child.once('error', reject)
        child.once('close', (value) => resolve(value))
        timer = setInterval(async () => {
          if (checking) return
          checking = true
          try {
            await retryObservation(
              async () => {
                cancellation.throwIfCancelled(signal, deploymentId)
                await ensureOwner()
                const current = await snapshot()
                if (current) await update(current)
              },
              { signal, deadline: now + 1260000 }
            )
            if (Date.now() > now + 1260000)
              throw new Error('Server CI exceeded its deadline.')
          } catch (error) {
            executionError = error
            stop()
          } finally {
            checking = false
          }
        }, 1000)
      })
      clearInterval(timer)
      while (checking) await new Promise((resolve) => setTimeout(resolve, 10))
      if (executionError) throw executionError
      await observeOwner(now + 1260000)
      report = await snapshot()
      if (
        !report ||
        report.id !== runId ||
        report.sourceRevision !== source.commit ||
        report.manifestDigest !== source.manifestDigest ||
        report.lockDigest !== source.lockDigest ||
        report.configRevision !== policy.configuration.configRevision
      )
        throw new Error(
          !report && setupDiagnostic.includes('Server CI needs 4 GiB')
            ? 'Server CI needs 4 GiB plus 1 GiB of available host memory. Free capacity or submit trusted local checks before retrying.'
            : 'Server CI evidence does not match its admitted source. Check Docker availability and instance storage before retrying.'
        )
      const final = await retryObservation(
        async () => {
          cancellation.throwIfCancelled(signal, deploymentId)
          await ensureOwner()
          return update(report)
        },
        { signal, deadline: now + 1260000 }
      )
      const failedStep = report.steps?.find((step) => step.state === 'failed')
      if (
        failedStep &&
        ['install', 'lint', 'test', 'build'].includes(failedStep.name)
      ) {
        let handle
        try {
          handle = await fs.open(
            path.join(output, failedStep.name + '.log'),
            'r'
          )
          const stat = await handle.stat(),
            tail = Buffer.alloc(Math.min(stat.size, 4096))
          if (stat.isFile()) {
            await handle.read(
              tail,
              0,
              tail.length,
              Math.max(0, stat.size - tail.length)
            )
            const text = tail
              .toString('utf8')
              .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
            final.logTail = sails.hooks.secrets?.text
              ? sails.hooks.secrets.text(text).slice(-4096)
              : 'Diagnostic output is unavailable.'
          }
        } catch {
          final.logTail =
            'Check output could not be read. Inspect deployment logs before retrying.'
        } finally {
          await handle?.close()
        }
      }
      final.finishedAt = Date.parse(report.finishedAt)
      final.serverProof = {
        executorDigest: executorDigest(),
        reportHash: contract.digest(report),
        checkNetwork: report.checkNetwork
      }
      const candidate = {
        ...run,
        state: 'passed',
        summary: final,
        receiptHash: final.serverProof.reportHash
      }
      if (
        code !== 0 ||
        !sails.helpers.ci.isServerEvidence.with({ run: candidate, policy })
      ) {
        await CiRun.updateOne({ id: run.id, state: 'pending' }).set({
          state: 'failed',
          completedAt: Date.now(),
          summary: {
            ...final,
            state: 'failed',
            reason: report.reason || 'Server checks did not pass.'
          }
        })
        throw new Error(
          report.reason || 'Server CI failed; the current release is unchanged.'
        )
      }
      const current = await observeOwner(now + 1260000)
      const admission = await withDatastoreTransaction(async (connection) => {
        const locked = await CiPolicy.updateOne({
          id: current.id,
          revision: policyRevision,
          enabled: true
        })
          .set({ revision: policyRevision })
          .usingConnection(connection)
        if (!locked)
          throw new Error('CI policy changed before result admission.')
        return CiRun.updateOne({ id: run.id, state: 'pending' })
          .set({
            state: 'passed',
            receiptHash: final.serverProof.reportHash,
            summary: final,
            completedAt: Date.now()
          })
          .usingConnection(connection)
      })
      if (!admission) throw new Error('Server result lost its admission fence.')
      await Deployment.appendBuildLog(
        deploymentId,
        'CI: install, lint, tests and asset build passed; cleanup completed.\n'
      )
      return { passed: true, runId }
    } catch (error) {
      await retryObservation(
        () =>
          CiRun.updateOne({ id: run.id, state: 'pending' }).set({
            state: 'failed',
            completedAt: Date.now(),
            summary: {
              ...latestSummary,
              state: cancellation.isCancellationError(error)
                ? 'cancelled'
                : 'failed',
              reason: sails.hooks.secrets?.text
                ? sails.hooks.secrets.text(String(error.message).slice(0, 1000))
                : 'Server CI stopped. Inspect deployment logs before retrying.',
              finishedAt: Date.now()
            }
          }),
        { deadline: Date.now() + 1500 }
      )
      throw error
    } finally {
      clearInterval(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', stop)
      // A forced executor exit still removes only its exact, server-owned container.
      try {
        await execute(
          sails.config.docker?.binaryPath || 'docker',
          ['rm', '-f', container],
          { timeout: 30000, maxBuffer: 65536 }
        )
      } catch {
        /* Inventory holds future capacity if cleanup is uncertain. */
      }
      await fs.rm(directory, { recursive: true, force: true })
    }
  }
}
