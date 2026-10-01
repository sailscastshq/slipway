const os = require('node:os')
const { randomBytes } = require('node:crypto')
module.exports = {
  friendlyName: 'Run restore test',
  description:
    'Restore one backup into a bounded, disposable PostgreSQL database and verify readable base tables.',
  inputs: {
    testId: { type: 'number', required: true },
    signal: { type: 'ref' }
  },
  fn: async function ({ testId, signal }) {
    const operation = await RestoreTest.findOne({ id: testId })
    if (!operation || operation.status !== 'running')
      throw new Error('Restore test is not running')
    const limits = sails.config.custom.databaseOperations
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    const deadline = setTimeout(abort, limits.restoreTestTimeoutMs)
    deadline.unref()
    const run = (args, timeoutMs = 30000) =>
      sails.helpers.streams.runProcess.with({
        command: sails.config.docker?.binaryPath || 'docker',
        args,
        timeoutMs,
        maxStderrBytes: limits.maxProcessStderrBytes,
        maxStdoutBytes: 64 * 1024,
        captureStdout: true,
        signal: controller.signal
      })
    let stage = 'preparing'
    let status = 'failed'
    let error = ''
    let report = {
      engine: 'postgresql',
      backupId: operation.backup,
      checks: []
    }
    const progress = async (next) => {
      stage = next
      await RestoreTest.updateOne({ id: testId }).set({ stage: next })
    }
    try {
      let backup = await Backup.findOne({ id: operation.backup })
      const service =
        backup && (await Service.findOne({ id: operation.service }))
      if (
        backup?.status === 'pending' &&
        service?.type === 'postgresql' &&
        service.managementMode !== 'external'
      ) {
        await progress('backup')
        await sails.helpers.backup.runBackup.with({
          backupId: String(backup.id),
          signal: controller.signal
        })
        backup = await Backup.findOne({ id: backup.id })
        await progress('preparing')
      }
      if (
        !backup ||
        backup.status !== 'completed' ||
        service?.type !== 'postgresql' ||
        service.managementMode === 'external'
      )
        throw new Error('INVALID_BACKUP')
      if (!backup.sizeBytes || backup.sizeBytes > limits.restoreTestMaxBytes)
        throw new Error('SIZE_LIMIT')
      const recorded = backup.storage?.database
      let image = recorded?.imageReference || service.imageReference
      if (!image) {
        const inspected = await run([
          'inspect',
          service.containerName,
          '--format',
          '{{.Image}}'
        ])
        image = inspected.stdout.trim()
      }
      if (!/^(?:sha256:[a-f0-9]{64}|[^\s]+@sha256:[a-f0-9]{64})$/.test(image))
        throw new Error('IMAGE_UNAVAILABLE')
      await run(['image', 'inspect', image])
      report = {
        ...report,
        backupCreatedAt: backup.createdAt,
        imageReference: image,
        compatibility: recorded
          ? 'Backup-time image'
          : 'Current service image; backup-time version was not recorded',
        checksumAvailable: Boolean(backup.storage?.checksum)
      }
      await sails.helpers.streams.getDiskCapacity.with({
        directory: os.tmpdir(),
        expectedBytes: backup.sizeBytes,
        maxBytes: limits.restoreTestMaxBytes,
        reserveBytes: limits.minFreeDiskBytes
      })
      const info = JSON.parse(
        (await run(['info', '--format', '{{json .}}'])).stdout
      )
      const stats = await sails.helpers.docker.getContainerStats()
      const used = stats.reduce((sum, item) => sum + item.memUsage, 0)
      if (!Number.isFinite(info.MemTotal) || info.MemTotal <= 0)
        throw new Error('MEMORY_CAPACITY')
      if (
        Math.min(os.freemem(), info.MemTotal - used) <
        limits.restoreTestMemoryBytes + limits.restoreTestReserveMemoryBytes
      )
        throw new Error('MEMORY_CAPACITY')
      const password = randomBytes(24).toString('hex')
      const target = {
        type: 'postgresql',
        containerName: operation.resourceName,
        username: 'postgres',
        password,
        database: 'restore_test',
        isRehearsal: true,
        maxBytes: limits.restoreTestMaxBytes,
        timeoutMs: limits.restoreTestTimeoutMs
      }
      await run([
        'run',
        '-d',
        '--name',
        target.containerName,
        '--label',
        `slipway.restore-test=${testId}`,
        '--label',
        `slipway.restore-test.resource=${target.containerName}`,
        '--network',
        'none',
        '--read-only',
        '--user',
        'postgres',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--memory',
        String(limits.restoreTestMemoryBytes),
        '--memory-swap',
        String(limits.restoreTestMemoryBytes),
        '--cpus',
        '0.5',
        '--pids-limit',
        '128',
        '--tmpfs',
        `/tmp:rw,size=${limits.restoreTestDataBytes},mode=1777`,
        '--tmpfs',
        '/var/run/postgresql:rw,size=1048576,mode=1777',
        '-e',
        'PGDATA=/tmp/database',
        '-e',
        `POSTGRES_PASSWORD=${password}`,
        '-e',
        'POSTGRES_DB=restore_test',
        image
      ])
      const sql = async (query) =>
        run(
          [
            'exec',
            '-e',
            `PGPASSWORD=${password}`,
            '-e',
            'PGOPTIONS=-c statement_timeout=10000',
            target.containerName,
            'psql',
            '-h',
            '127.0.0.1',
            '-U',
            'postgres',
            '-d',
            'restore_test',
            '-v',
            'ON_ERROR_STOP=1',
            '-tAc',
            query
          ],
          15000
        )
      let ready = false
      for (let i = 0; i < 60; i++) {
        if (controller.signal.aborted) throw new Error('CANCELLED')
        try {
          await sql('SELECT 1')
          ready = true
          break
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      if (!ready) throw new Error('TARGET_UNAVAILABLE')
      await progress('download')
      const transfer = await sails.helpers.backup.restoreBackup.with({
        backupId: String(backup.id),
        isolatedTarget: target,
        signal: controller.signal,
        onProgress: progress
      })
      report.bytes = transfer.bytes
      report.checks.push(
        'Recorded file size matches',
        transfer.checksumVerified
          ? 'SHA-256 checksum verified'
          : 'Legacy backup: no recorded checksum',
        'PostgreSQL import completed without errors'
      )
      await progress('verifying')
      report.serverVersion = (await sql('SHOW server_version')).stdout.trim()
      const count = Number(
        (
          await sql(
            "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%'"
          )
        ).stdout.trim()
      )
      if (!Number.isFinite(count) || count > 500)
        throw new Error('VERIFICATION_LIMIT')
      await sql(
        "DO $$ DECLARE t record; BEGIN FOR t IN SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' LOOP EXECUTE format('SELECT 1 FROM %I.%I LIMIT 1', t.nspname, t.relname); END LOOP; END $$;"
      )
      report.tablesChecked = count
      report.checks.push(
        'Database connectivity verified',
        `All ${count} restored base tables are readable`
      )
      status = 'completed'
    } catch (cause) {
      status = controller.signal.aborted ? 'cancelled' : 'failed'
      error =
        status === 'cancelled'
          ? 'Restore test cancelled or reached its time limit. The running database was unchanged.'
          : errorFor(stage, cause.code || cause.message)
      report.failedStage = stage
    } finally {
      clearTimeout(deadline)
      signal?.removeEventListener('abort', abort)
      await progress('cleanup')
      let cleanupPending = false
      try {
        await sails.helpers.backup.cleanupRestoreTest(operation)
        report.cleanup = 'removed'
      } catch {
        cleanupPending = true
        report.cleanup = 'needs_attention'
      }
      await RestoreTest.updateOne({ id: testId }).set({
        status,
        stage: cleanupPending ? 'cleanup_pending' : status,
        error,
        report,
        cleanupPending,
        completedAt: Date.now()
      })
      await sails.helpers.audit.log
        .with({
          action: `backup.restore-test.${status}`,
          resourceType: 'backup',
          resourceId: String(operation.backup),
          userId: operation.requestedBy
            ? String(operation.requestedBy)
            : undefined,
          teamId: String(operation.team),
          details: { testId, cleanupPending }
        })
        .intercept(() => {})
    }
  }
}
function errorFor(stage, code) {
  if (code === 'INSUFFICIENT_DISK_SPACE')
    return 'Not enough temporary disk space. Free space on the Slipway host, then retry.'
  if (code === 'MEMORY_CAPACITY')
    return 'Not enough free memory for an isolated database. Free host resources, then retry.'
  if (['SIZE_LIMIT', 'VERIFICATION_LIMIT'].includes(code))
    return 'This backup exceeds the bounded restore-test limits. Use a separately provisioned recovery database.'
  if (['IMAGE_UNAVAILABLE', 'TARGET_UNAVAILABLE'].includes(code))
    return 'The compatible database image could not start. Check the service image and Docker access, then retry.'
  return (
    {
      backup:
        'Could not create a verified backup. Check backup storage and database access before retrying.',
      preparing:
        'Could not prepare the isolated database. Check Docker access, the saved backup and host capacity, then retry.',
      download:
        'Could not verify the downloaded backup. Check backup storage access and the recorded file size/checksum.',
      import:
        'PostgreSQL could not restore this backup. Check database version compatibility and the temporary database size limit.',
      verifying:
        'Restoration finished, but database readability could not be verified. Test this backup in a separately provisioned recovery database.'
    }[stage] || 'Restore test failed. Your running database was unchanged.'
  )
}
