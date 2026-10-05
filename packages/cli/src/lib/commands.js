// Command aliases (alias → primary command)
export const aliases = {
  deploy: 'slide',
  launch: 'slide',
  exec: 'run'
}

const outputOptions = { json: { type: 'boolean' }, ndjson: { type: 'boolean' } }
const targetOptions = {
  project: { type: 'string', short: 'p' },
  env: { type: 'string', short: 'e', default: 'production' },
  app: { type: 'string', short: 'a' }
}

export const commands = {
  'upgrade:plan': {
    description:
      'Review the advertised pinned instance upgrade without stopping writers',
    options: { ...outputOptions }
  },
  'upgrade:apply': {
    description:
      'Accept an exact reviewed instance upgrade; preserve its durable recovery receipt',
    options: {
      ...outputOptions,
      instance: { type: 'string' },
      'approve-plan': { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string', default: '900' }
    }
  },
  'upgrade:status': {
    description: 'Inspect the native upgrade checkpoint',
    args: '[upgrade-id]',
    options: { ...outputOptions }
  },
  'upgrade:resume': {
    description:
      'Resume the exact owned checkpoint without restoring older storage',
    args: '<upgrade-id>',
    options: {
      ...outputOptions,
      instance: { type: 'string' },
      'approve-plan': { type: 'string' },
      wait: { type: 'boolean' },
      timeout: { type: 'string', default: '900' }
    }
  },
  doctor: {
    description:
      'Check server health, saved CLI authentication, and optional target readiness',
    options: { ...targetOptions, ...outputOptions }
  },
  apps: {
    description:
      'List apps without printing environment variables or credentials',
    options: { ...targetOptions, ...outputOptions }
  },
  'app:inspect': {
    description: 'Inspect one explicit app target',
    options: { ...targetOptions, ...outputOptions }
  },
  'app:restart': {
    description: 'Restart one reviewed target through the existing server API',
    options: {
      ...targetOptions,
      ...outputOptions,
      'approve-target': { type: 'string' }
    }
  },
  'run:cancel': {
    description:
      'Request cancellation of an owned active execution; report confirmation truthfully',
    args: '<execution-id>',
    options: { ...outputOptions }
  },
  'run:history': {
    description:
      'List retained command metadata, without source, output, or UUID lookup',
    options: { ...targetOptions, ...outputOptions }
  },
  'run:arm': {
    description:
      'Arm an approved exact production command using a private single-use token file',
    args: '[command]',
    options: {
      ...targetOptions,
      ...outputOptions,
      'approve-target': { type: 'string' },
      output: { type: 'string' },
      stdin: { type: 'boolean' },
      file: { type: 'string' }
    }
  },
  'service:review': {
    description: 'Review a private custom image before creation',
    args: '<image>',
    options: {
      env: { type: 'string', default: 'production' },
      name: { type: 'string' },
      port: { type: 'string' },
      app: { type: 'string' },
      definition: { type: 'string' },
      json: { type: 'boolean' }
    }
  },
  'service:create': {
    description: 'Create exactly the previously reviewed custom service',
    args: '<review-id>',
    options: {}
  },

  // Auth commands
  login: {
    description: 'Authenticate with your Slipway server',
    options: { server: { type: 'string', short: 's' } }
  },
  logout: {
    description: 'Clear stored credentials',
    options: {}
  },
  whoami: {
    description: 'Show current authenticated user',
    options: {}
  },

  // Project commands
  projects: {
    description: 'List all projects',
    options: {}
  },
  'project:update': {
    description: 'Update a project',
    args: '<slug>',
    options: {
      name: { type: 'string', short: 'n' },
      description: { type: 'string', short: 'd' },
      repo: { type: 'string', short: 'r' }
    }
  },
  init: {
    description: 'Initialize a new Slipway project',
    options: { name: { type: 'string', short: 'n' } }
  },
  link: {
    description: 'Link current directory to an existing project',
    args: '<project>',
    options: {}
  },

  // Environment commands
  environments: {
    description: 'List environments for the current project',
    options: {}
  },
  'environment:create': {
    description: 'Create a new environment',
    args: '<name>',
    options: {
      production: { type: 'boolean', short: 'p' },
      domain: { type: 'string', short: 'd' },
      from: { type: 'string', short: 'f' }
    }
  },
  'environment:update': {
    description: 'Update an environment',
    args: '<slug>',
    options: {
      name: { type: 'string', short: 'n' },
      domain: { type: 'string', short: 'd' },
      production: { type: 'boolean', short: 'p' }
    }
  },

  // Deployment commands
  push: {
    description: 'Push source code without deploying',
    options: {}
  },
  slide: {
    description: 'Push and deploy the current project',
    aliases: ['deploy', 'launch'],
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' },
      message: { type: 'string', short: 'm' }
    }
  },
  readiness: {
    description:
      'Inspect server-owned deployment readiness for the current source',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' },
      json: { type: 'boolean' }
    }
  },
  deployments: {
    description: 'List recent deployments',
    options: {
      env: { type: 'string', short: 'e' },
      limit: { type: 'string', short: 'n', default: '10' }
    }
  },
  logs: {
    description: 'View application logs',
    options: {
      project: { type: 'string', short: 'p' },
      json: { type: 'boolean' },
      ndjson: { type: 'boolean' },
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' },
      follow: { type: 'boolean', short: 'f' },
      tail: { type: 'string', short: 'n', default: '100' },
      deployment: { type: 'string', short: 'd' }
    }
  },

  // Database commands
  'db:create': {
    description: 'Create a new database service',
    args: '<name>',
    options: {
      type: { type: 'string', short: 't', default: 'postgresql' },
      version: { type: 'string', short: 'v' },
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },
  'db:url': {
    description: 'Get database connection URL',
    args: '<name>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },

  // Service commands
  services: {
    description: 'List all services',
    options: {
      env: { type: 'string', short: 'e' }
    }
  },

  // Environment variable commands
  env: {
    description: 'List environment variables',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },
  'env:set': {
    description: 'Set environment variables (KEY=value)',
    args: '<pairs...>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },
  'env:unset': {
    description: 'Remove environment variables',
    args: '<keys...>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' }
    }
  },

  // Backup commands
  'backup:create': {
    description: 'Create a manual database backup',
    args: '<service-name>',
    options: { env: { type: 'string', short: 'e', default: 'production' } }
  },
  'backup:list': {
    description: 'List backups for a database service',
    args: '<service-name>',
    options: { env: { type: 'string', short: 'e', default: 'production' } }
  },
  'backup:restore': {
    description: 'Restore a database backup',
    args: '<backup-id>',
    options: { 'writes-paused': { type: 'boolean', default: false } }
  },

  // Admin commands
  'audit-log': {
    description: 'View audit log entries',
    options: {
      page: { type: 'string', short: 'p', default: '1' },
      limit: { type: 'string', short: 'n', default: '20' }
    }
  },

  // Container access
  terminal: {
    description:
      'Show direct Docker shell instructions; no interactive CLI terminal transport',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' }
    }
  },
  run: {
    description: 'Run a bounded command through guarded Helm',
    aliases: ['exec'],
    args: '<command...>',
    options: {
      project: { type: 'string', short: 'p' },
      json: { type: 'boolean' },
      ndjson: { type: 'boolean' },
      stdin: { type: 'boolean' },
      file: { type: 'string' },
      'write-arm-file': { type: 'string' },
      'receipt-file': { type: 'string' },
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' }
    }
  }
}
