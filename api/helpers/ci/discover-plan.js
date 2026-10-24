const crypto = require('node:crypto')

module.exports = {
  friendlyName: 'Discover Slipway CI plan',
  description:
    'Suggest checks from declarative source metadata without executing repository code.',
  inputs: {
    manifest: { type: 'ref', required: true },
    lockfiles: { type: 'json', defaultsTo: [] }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ manifest, lockfiles = [] }) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      throw new Error('A package.json object is required.')
    const serialized = JSON.stringify(manifest)
    if (Buffer.byteLength(serialized) > 256 * 1024)
      throw new Error('package.json exceeds the discovery limit.')
    if (!Array.isArray(lockfiles))
      throw new Error('Lockfile discovery must be a list of root filenames.')
    const scripts = manifest.scripts || {}
    const placeholderTest =
      /^echo\s+[\"']?Error: no test specified[\"']?\s*&&\s*exit\s+1;?$/.test(
        String(scripts.test || '').trim()
      )
    const managers = {
      'npm-shrinkwrap.json': 'npm',
      'package-lock.json': 'npm',
      'pnpm-lock.yaml': 'pnpm',
      'yarn.lock': 'yarn'
    }
    const found = Object.keys(managers).filter((name) =>
      lockfiles.includes(name)
    )
    const families = [...new Set(found.map((name) => managers[name]))]
    const declared =
      typeof manifest.packageManager === 'string'
        ? /^(npm|pnpm|yarn)@(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?)(?:\+sha(?:224|256|384|512)\.[a-f0-9]+)?$/.exec(
            manifest.packageManager
          )
        : null
    const blockers = []
    if (!found.length)
      blockers.push('Commit a supported lockfile before enabling Slipway CI.')
    if (families.length > 1)
      blockers.push(
        'Choose one package manager and remove conflicting lockfiles.'
      )
    if (manifest.packageManager && !declared)
      blockers.push(
        'Pin packageManager to a supported exact npm, pnpm or Yarn version.'
      )
    const manager =
      declared?.[1] || (families.length === 1 ? families[0] : null)
    if (declared && families.length && !families.includes(manager))
      blockers.push('packageManager does not match the committed lockfile.')
    const has = (name) =>
      typeof scripts[name] === 'string' &&
      scripts[name].trim() &&
      !(name === 'test' && placeholderTest)
    const steps = []
    const add = (name, kind, suggestedRequired) => {
      if (!has(name)) return
      const script = scripts[name]
      if (script.length > 8192)
        throw new Error('A package script exceeds the review limit.')
      steps.push({
        id: name,
        kind,
        script,
        executable: manager,
        args: manager ? ['run', name] : [],
        suggestedRequired,
        approved: false,
        timeoutSeconds: kind === 'test' ? 600 : 300
      })
    }
    add('lint', 'lint', true)
    for (const name of ['format:check', 'check:format'])
      add(name, 'format', true)
    for (const name of ['typecheck', 'type-check', 'check:types'])
      add(name, 'types', true)
    add('test', 'test', true)
    for (const name of ['test:unit', 'test:functional', 'test:e2e'])
      add(name, 'test', !has('test'))
    for (const name of Object.keys(scripts).sort())
      if (
        /^check:[a-z][a-z0-9-]*$/.test(name) &&
        !steps.some((step) => step.id === name)
      )
        add(name, 'check', false)
    add('build', 'build', true)
    const dependencies = {
      ...manifest.devDependencies,
      ...manifest.dependencies
    }
    const serviceHints = [
      ['sails-postgresql', 'postgresql'],
      ['sails-sqlite', 'sqlite'],
      ['@sailshq/connect-redis', 'redis'],
      ['@sailshq/socket.io-redis', 'redis']
    ]
      .filter(([dependency]) => Object.hasOwn(dependencies, dependency))
      .map(([, service]) => service)
    const installArgs =
      manager === 'npm'
        ? ['ci']
        : manager === 'pnpm'
        ? ['install', '--frozen-lockfile']
        : manager === 'yarn' && declared
        ? Number(declared[2].split('.')[0]) === 1
          ? ['install', '--frozen-lockfile']
          : ['install', '--immutable']
        : []
    if (manager === 'yarn' && !declared)
      blockers.push(
        'Pin Yarn so Slipway CI can choose the correct immutable install command.'
      )
    return {
      schemaVersion: 1,
      name: manifest.name || null,
      manifestFingerprint:
        'sha256:' +
        crypto.createHash('sha256').update(serialized).digest('hex'),
      framework: Object.hasOwn(dependencies, 'sails') ? 'sails' : 'node',
      runtime: {
        nodeRange: manifest.engines?.node || null,
        requiresConfirmation: true
      },
      packageManager: {
        name: manager,
        version: declared?.[2] || null,
        lockfile: found.find((name) => managers[name] === manager) || null,
        requiresConfirmation: !declared
      },
      install: { executable: manager, args: installArgs, approved: false },
      testFramework: Object.hasOwn(dependencies, 'sounding')
        ? 'sounding'
        : null,
      serviceHints: [...new Set(serviceHints)],
      serviceHintNote:
        'Dependency hints only. Confirm test configuration and service versions; no production settings are imported.',
      steps,
      testStatus: steps.some((step) => step.kind === 'test')
        ? 'Test command discovered'
        : 'No tests configured',
      blockers,
      requiresApproval: true,
      runnable: false
    }
  }
}
