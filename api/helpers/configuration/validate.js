const path = require('path')

const MEMORY_UNITS = {
  b: 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
  t: 1024 ** 4
}

module.exports = {
  friendlyName: 'Validate configuration',

  description:
    'Validate project, environment, app, and service configuration values.',

  inputs: {
    values: {
      type: 'ref',
      required: true
    },
    requiredFields: {
      type: 'json',
      defaultsTo: []
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  sync: true,

  fn: function ({ values, requiredFields }) {
    const problems = []
    const required = new Set(requiredFields)

    function add(field, message) {
      problems.push({ [field]: message })
    }

    function isMissing(value) {
      return (
        value === undefined || value === null || String(value).trim() === ''
      )
    }

    if (required.has('name') && isMissing(values.name)) {
      add('name', 'Name is required.')
    } else if (values.name !== undefined) {
      const name = String(values.name).trim()
      if (!name) {
        add('name', 'Name cannot be empty.')
      } else if (name.length > 120) {
        add('name', 'Name must be 120 characters or less.')
      } else if (!/[a-z0-9]/i.test(name)) {
        add('name', 'Name must include at least one letter or number.')
      }
    }

    if (
      values.description !== undefined &&
      String(values.description || '').length > 500
    ) {
      add('description', 'Description must be 500 characters or less.')
    }

    if (!isMissing(values.repositoryUrl)) {
      try {
        const repositoryUrl = new URL(String(values.repositoryUrl).trim())
        if (
          !['http:', 'https:'].includes(repositoryUrl.protocol) ||
          !repositoryUrl.hostname ||
          repositoryUrl.username ||
          repositoryUrl.password
        ) {
          throw new Error('invalid repository URL')
        }
      } catch {
        add(
          'repositoryUrl',
          'Enter a valid HTTP or HTTPS repository URL without credentials.'
        )
      }
    }

    if (values.autoDeploy === true || !isMissing(values.autoDeployBranch)) {
      const branch = String(values.autoDeployBranch || '').trim()
      const invalidBranch =
        !branch ||
        branch.length > 255 ||
        branch.startsWith('-') ||
        branch.startsWith('/') ||
        branch.endsWith('/') ||
        branch.endsWith('.') ||
        branch.includes('..') ||
        branch.includes('//') ||
        branch.includes('@{') ||
        /[\s~^:?*\[\]\\\u0000-\u001f\u007f]/.test(branch)

      if (invalidBranch) {
        add('autoDeployBranch', 'Enter a valid Git branch name.')
      }
    }

    if (required.has('dockerfilePath') && isMissing(values.dockerfilePath)) {
      add('dockerfilePath', 'Dockerfile path is required.')
    } else if (values.dockerfilePath !== undefined) {
      const dockerfilePath = String(values.dockerfilePath || '').trim()
      const segments = dockerfilePath.split('/')
      const invalidDockerfilePath =
        !dockerfilePath ||
        dockerfilePath.length > 255 ||
        path.posix.isAbsolute(dockerfilePath) ||
        /^[a-z]:/i.test(dockerfilePath) ||
        dockerfilePath.includes('\\') ||
        dockerfilePath.includes('\u0000') ||
        segments.includes('..') ||
        segments.some((segment) => !segment)

      if (invalidDockerfilePath) {
        add(
          'dockerfilePath',
          'Use a relative Dockerfile path inside the project.'
        )
      }
    }

    for (const field of ['healthPath', 'routePath']) {
      const value = values[field]
      if (field === 'routePath' && value === null) continue

      if (required.has(field) && isMissing(value)) {
        add(
          field,
          `${field === 'healthPath' ? 'Health' : 'Route'} path is required.`
        )
        continue
      }

      if (value === undefined) continue

      const route = String(value || '').trim()
      const invalidRoute =
        !route ||
        route.length > 256 ||
        !route.startsWith('/') ||
        route.startsWith('//') ||
        (route.length > 1 && route.endsWith('/')) ||
        /[\s?#*<>"\\\u0000-\u001f\u007f]/.test(route)

      if (invalidRoute) {
        add(
          field,
          `Enter a valid ${
            field === 'healthPath' ? 'health' : 'route'
          } path beginning with /.`
        )
      }
    }

    if (!isMissing(values.domain)) {
      const domain = String(values.domain).trim().toLowerCase()
      const labels = domain.split('.')
      const invalidDomain =
        domain.length > 253 ||
        labels.some(
          (label) =>
            !label ||
            label.length > 63 ||
            !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
        )

      if (invalidDomain) {
        add('domain', 'Enter a valid hostname without a scheme or path.')
      }
    }

    if (values.resourceLimits !== undefined) {
      const resourceLimits = values.resourceLimits || {}
      const cpus = String(resourceLimits.cpus || '').trim()
      const cpuCount = Number(cpus)

      if (
        !cpus ||
        !Number.isFinite(cpuCount) ||
        cpuCount <= 0 ||
        cpuCount > 256
      ) {
        add(
          'resourceLimits.cpus',
          'CPU limit must be greater than 0 and no more than 256.'
        )
      }

      const memory = String(resourceLimits.memory || '')
        .trim()
        .toLowerCase()
      const memoryMatch = memory.match(/^(\d+(?:\.\d+)?)([bkmgt])$/)
      const memoryBytes = memoryMatch
        ? Number(memoryMatch[1]) * MEMORY_UNITS[memoryMatch[2]]
        : 0

      if (
        !memoryMatch ||
        memoryBytes < 6 * MEMORY_UNITS.m ||
        memoryBytes > MEMORY_UNITS.t
      ) {
        add(
          'resourceLimits.memory',
          'Memory limit must be between 6m and 1t, for example 512m or 1g.'
        )
      }
    }

    return problems
  }
}
