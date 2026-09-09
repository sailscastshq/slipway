// Command aliases (alias → primary command)
export const aliases = {
  deploy: 'slide',
  launch: 'slide'
}

export const commands = {
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
    description: 'Open a terminal session in the running container',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' }
    }
  },
  run: {
    description: 'Run a command in the container',
    args: '<command...>',
    options: {
      env: { type: 'string', short: 'e', default: 'production' },
      app: { type: 'string', short: 'a' }
    }
  }
}
