const { Readable } = require('node:stream')
const { randomUUID } = require('node:crypto')
const contract = require('../../lib/external-postgresql')
const removeClient = require('../../lib/remove-external-client')
module.exports = {
  friendlyName: 'Run isolated external PostgreSQL client',
  inputs: {
    serviceId: { type: 'string', required: true },
    operation: { type: 'string', isIn: ['verify', 'dump'], required: true },
    output: { type: 'ref' },
    maxBytes: { type: 'number', min: 1, defaultsTo: 65536 },
    timeoutMs: { type: 'number', min: 1, defaultsTo: 30000 },
    signal: { type: 'ref' }
  },
  fn: async function ({
    serviceId,
    operation,
    output,
    maxBytes,
    timeoutMs,
    signal
  }) {
    const service = await Service.findOne({ id: serviceId }).decrypt()
    if (
      service?.managementMode !== 'external' ||
      service.type !== 'postgresql' ||
      !service.externalConnection
    )
      throw contract.normalize({ code: 'EXTERNAL_CONFIGURATION' })
    const docker = sails.config.docker?.binaryPath || 'docker'
    const name = `slipway-pg-client-${randomUUID()}`
    let launched = false
    try {
      signal?.throwIfAborted()
      await sails.helpers.service.cleanupExternalClient(serviceId)
      let reference = service.imageReference
      if (!reference) {
        const resolved = await sails.helpers.docker.resolveServiceImage.with({
          type: 'postgresql',
          version: '17',
          signal,
          timeoutMs: Math.min(timeoutMs, 30000)
        })
        reference = resolved.imageReference
        await Service.updateOne({ id: service.id }).set({
          imageReference: reference,
          imageMetadata: { clientVersion: '17', resolvedAt: Date.now() }
        })
      }
      if (!/^(?:postgres@sha256:|sha256:)[a-f0-9]{64}$/.test(reference))
        throw new Error('Unverified PostgreSQL client image')
      signal?.throwIfAborted()
      // Stream credentials into private tmpfs: host bind mounts do not work
      // when Slipway itself runs in a container with the host Docker socket.
      const input = Readable.from([
        [
          contract.serviceFile(service.externalConnection),
          contract.passwordFile(service.externalConnection),
          service.externalConnection.caCertificate || ''
        ]
          .map((value) => Buffer.from(value).toString('base64'))
          .join('\n') + '\n'
      ])
      const args = [
        'run',
        '--interactive',
        '--rm',
        '--name',
        name,
        '--network',
        sails.config.custom.externalDatabaseClientNetwork || 'slipway',
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '64',
        '--memory',
        '256m',
        '--cpus',
        '0.5',
        '--user',
        '65534:65534',
        '--tmpfs',
        '/run/slipway:rw,noexec,nosuid,nodev,size=1m,mode=0700,uid=65534,gid=65534',
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=32m',
        '--env',
        'PGSERVICEFILE=/run/slipway/pg_service.conf',
        '--env',
        'PGSERVICE=slipway',
        '--env',
        'PGPASSFILE=/run/slipway/pgpass',
        '--env',
        `PGOPTIONS=-c statement_timeout=${Math.ceil(
          timeoutMs
        )} -c lock_timeout=10000`,
        reference,
        'sh',
        '-c',
        'set -eu; umask 077; IFS= read -r config; IFS= read -r password; IFS= read -r ca; printf "%s" "$config" | base64 -d > /run/slipway/pg_service.conf; printf "%s" "$password" | base64 -d > /run/slipway/pgpass; printf "%s" "$ca" | base64 -d > /run/slipway/ca.pem; unset config password ca; exec "$@"',
        'slipway-client'
      ]
      if (operation === 'dump')
        args.push('pg_dump', '--format=custom', '--no-password')
      else
        args.push(
          'psql',
          '--no-password',
          '--no-psqlrc',
          '--tuples-only',
          '--no-align',
          '--set',
          'ON_ERROR_STOP=1',
          '--command',
          `SELECT json_build_object('version',current_setting('server_version_num')::integer,'canDump',NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND ((c.relkind IN ('r','p','m') AND NOT has_table_privilege(c.oid,'SELECT')) OR (c.relkind='S' AND NOT has_sequence_privilege(c.oid,'SELECT')))));`
        )
      launched = true
      return await sails.helpers.streams.runProcess.with({
        command: docker,
        args,
        output,
        input,
        maxInputBytes: 256 * 1024,
        maxOutputBytes: maxBytes,
        maxStderrBytes: 8192,
        captureStdout: operation === 'verify',
        timeoutMs,
        signal,
        killGraceMs: 2000
      })
    } catch (error) {
      throw contract.normalize(error)
    } finally {
      let cleanupFailed = false
      try {
        if (launched) await removeClient(docker, name)
      } catch (error) {
        cleanupFailed = true
      } finally {
        output?.destroy()
      }
      if (cleanupFailed) {
        await Service.updateOne({ id: service.id }).set({
          status: 'unreachable',
          externalVerification: {
            ...service.externalVerification,
            cleanupContainer: name
          }
        })
        const error = new Error(
          'External client cleanup could not be confirmed. Check Docker and retry verification.'
        )
        error.code = 'EXTERNAL_CLEANUP'
        throw error
      }
    }
  }
}
