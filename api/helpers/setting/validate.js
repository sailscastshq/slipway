const net = require('net')

module.exports = {
  friendlyName: 'Validate settings',

  description: 'Validate instance, integration, storage, and team settings.',

  inputs: {
    values: {
      type: 'ref',
      required: true
    },
    requiredFields: {
      type: 'json',
      defaultsTo: []
    },
    request: {
      type: 'ref'
    }
  },

  exits: {
    success: {
      outputType: 'ref'
    }
  },

  sync: true,

  fn: function ({ values, requiredFields, request }) {
    const problems = []
    const required = new Set(requiredFields)
    const validateOnly = new Set(
      String(request?.header?.('Precognition-Validate-Only') || '')
        .split(',')
        .map((field) => field.trim())
        .filter(Boolean)
    )

    function add(field, message) {
      problems.push({ [field]: message })
    }

    function isMissing(value) {
      return (
        value === undefined || value === null || String(value).trim() === ''
      )
    }

    function shouldCheck(field) {
      if (!validateOnly.size) return true
      return [...validateOnly].some(
        (requested) =>
          requested === field ||
          requested.startsWith(`${field}.`) ||
          field.startsWith(`${requested}.`)
      )
    }

    function validateRequired(field, label) {
      if (!shouldCheck(field)) return false
      if (required.has(field) && isMissing(values[field])) {
        add(field, `${label} is required.`)
        return false
      }
      return true
    }

    function isEmail(value) {
      const email = String(value || '').trim()
      return (
        email.length <= 254 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
        !email.includes('..')
      )
    }

    function isHostname(value) {
      const hostname = String(value || '').toLowerCase()
      if (hostname === 'localhost' || net.isIP(hostname)) return true
      if (hostname.length > 253 || !hostname.includes('.')) return false

      return hostname
        .split('.')
        .every(
          (label) =>
            label.length > 0 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
        )
    }

    function isHttpUrl(value, { httpsOnly = false } = {}) {
      try {
        const url = new URL(String(value || '').trim())
        return (
          (httpsOnly
            ? url.protocol === 'https:'
            : ['http:', 'https:'].includes(url.protocol)) &&
          Boolean(url.hostname) &&
          !url.username &&
          !url.password
        )
      } catch {
        return false
      }
    }

    if (validateRequired('name', 'Name') && values.name !== undefined) {
      const name = String(values.name).trim()
      if (!name) {
        add('name', 'Name cannot be empty.')
      } else if (name.length > 100) {
        add('name', 'Name must be 100 characters or less.')
      } else if (!/[a-z0-9]/i.test(name)) {
        add('name', 'Name must include at least one letter or number.')
      }
    }

    if (shouldCheck('instanceName') && values.instanceName !== undefined) {
      const instanceName = String(values.instanceName).trim()
      if (instanceName.length > 100) {
        add('instanceName', 'Instance name must be 100 characters or less.')
      } else if (instanceName && !/[a-z0-9]/i.test(instanceName)) {
        add(
          'instanceName',
          'Instance name must include at least one letter or number.'
        )
      }
    }

    if (shouldCheck('instanceDomain') && !isMissing(values.instanceDomain)) {
      try {
        const cleanDomain = String(values.instanceDomain)
          .trim()
          .replace(/^https?:\/\//i, '')
          .replace(/\/+$/, '')
        const url = new URL(`http://${cleanDomain}`)
        const valid =
          isHostname(url.hostname) &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !url.username &&
          !url.password

        if (!valid) throw new Error('invalid domain')
      } catch {
        add('instanceDomain', 'Enter a valid domain without a path.')
      }
    }

    if (
      shouldCheck('acmeEmail') &&
      !isMissing(values.acmeEmail) &&
      !isEmail(values.acmeEmail)
    ) {
      add('acmeEmail', 'Enter a valid email address.')
    }
    if (
      shouldCheck('email') &&
      !isMissing(values.email) &&
      !isEmail(values.email)
    ) {
      add('email', 'Enter a valid email address.')
    }

    for (const [field, label] of [
      ['clientId', 'Client ID'],
      ['clientSecret', 'Client secret']
    ]) {
      if (validateRequired(field, label) && !isMissing(values[field])) {
        const maxLength = field === 'clientSecret' ? 4096 : 255
        if (String(values[field]).trim().length > maxLength) {
          add(field, `${label} is too long.`)
        }
      }
    }

    if (shouldCheck('envVars') && values.envVars !== undefined) {
      const envVars = values.envVars
      if (!envVars || typeof envVars !== 'object' || Array.isArray(envVars)) {
        add('envVars', 'Environment variables must be key-value pairs.')
      } else {
        for (const [key, value] of Object.entries(envVars)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            add(
              'envVars',
              'Variable names may contain only letters, numbers, and underscores, and cannot start with a number.'
            )
            break
          }
          if (
            value !== null &&
            !['string', 'number', 'boolean'].includes(typeof value)
          ) {
            add('envVars', 'Environment variable values must be scalar values.')
            break
          }
        }
      }
    }

    if (shouldCheck('envVars') && !isMissing(values.envSource)) {
      const names = new Set()
      for (const line of String(values.envSource).split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const separator = trimmed.indexOf('=')
        const key = separator === -1 ? '' : trimmed.slice(0, separator).trim()
        if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          add(
            'envVars',
            'Each environment variable must use a valid KEY=value line.'
          )
          break
        }
        if (names.has(key)) {
          add('envVars', 'Environment variable names must be unique.')
          break
        }
        names.add(key)
      }
    }

    const enabledRequirements = [
      ['telegramEnabled', 'telegramBotToken', 'Telegram bot token'],
      ['telegramEnabled', 'telegramChatId', 'Telegram chat ID'],
      ['discordEnabled', 'discordWebhookUrl', 'Discord webhook URL'],
      ['slackEnabled', 'slackWebhookUrl', 'Slack webhook URL'],
      ['webhookEnabled', 'webhookUrl', 'Webhook URL'],
      ['smtpEnabled', 'smtpHost', 'SMTP host'],
      ['smtpEnabled', 'smtpFrom', 'From address'],
      ['smtpEnabled', 'notificationEmails', 'Notification recipients']
    ]
    for (const [enabledField, field, label] of enabledRequirements) {
      if (
        shouldCheck(field) &&
        values[enabledField] === true &&
        isMissing(values[field])
      ) {
        add(field, `${label} is required when this channel is enabled.`)
      }
    }

    if (
      shouldCheck('telegramBotToken') &&
      !isMissing(values.telegramBotToken) &&
      values.telegramEnabled !== false &&
      !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(
        String(values.telegramBotToken).trim()
      )
    ) {
      add('telegramBotToken', 'Enter a valid Telegram bot token.')
    }
    if (
      shouldCheck('telegramChatId') &&
      !isMissing(values.telegramChatId) &&
      values.telegramEnabled !== false &&
      !/^-?\d+$/.test(String(values.telegramChatId).trim())
    ) {
      add('telegramChatId', 'Enter a valid Telegram chat ID.')
    }
    if (
      shouldCheck('telegramThreadId') &&
      !isMissing(values.telegramThreadId) &&
      values.telegramEnabled !== false &&
      !/^\d+$/.test(String(values.telegramThreadId).trim())
    ) {
      add('telegramThreadId', 'Enter a valid Telegram topic ID.')
    }

    for (const [field, label, httpsOnly] of [
      ['discordWebhookUrl', 'Discord webhook URL', true],
      ['slackWebhookUrl', 'Slack webhook URL', true],
      ['webhookUrl', 'webhook URL', false],
      ['endpoint', 'endpoint URL', false],
      ['publicUrl', 'public URL', false]
    ]) {
      const enabledField = {
        discordWebhookUrl: 'discordEnabled',
        slackWebhookUrl: 'slackEnabled',
        webhookUrl: 'webhookEnabled'
      }[field]
      if (
        shouldCheck(field) &&
        !isMissing(values[field]) &&
        (!enabledField || values[enabledField] !== false) &&
        !isHttpUrl(values[field], { httpsOnly })
      ) {
        add(
          field,
          `Enter a valid ${
            httpsOnly ? 'HTTPS' : 'HTTP or HTTPS'
          } ${label} without credentials.`
        )
      }
    }

    if (
      shouldCheck('smtpHost') &&
      !isMissing(values.smtpHost) &&
      values.smtpEnabled !== false
    ) {
      const smtpHost = String(values.smtpHost).trim()
      if (
        smtpHost.length > 253 ||
        smtpHost.includes('://') ||
        smtpHost.includes('/') ||
        !isHostname(smtpHost)
      ) {
        add('smtpHost', 'Enter a valid SMTP hostname or IP address.')
      }
    }
    if (
      shouldCheck('smtpPort') &&
      !isMissing(values.smtpPort) &&
      values.smtpEnabled !== false
    ) {
      const smtpPort = Number(values.smtpPort)
      if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        add('smtpPort', 'SMTP port must be between 1 and 65535.')
      }
    }
    if (
      shouldCheck('smtpFrom') &&
      !isMissing(values.smtpFrom) &&
      values.smtpEnabled !== false &&
      !isEmail(values.smtpFrom)
    ) {
      add('smtpFrom', 'Enter a valid from email address.')
    }
    if (
      shouldCheck('notificationEmails') &&
      !isMissing(values.notificationEmails) &&
      values.smtpEnabled !== false
    ) {
      const emails = String(values.notificationEmails)
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean)
      if (!emails.length || emails.some((email) => !isEmail(email))) {
        add(
          'notificationEmails',
          'Enter valid email addresses separated by commas.'
        )
      }
    }

    if (validateRequired('provider', 'Storage provider')) {
      if (
        values.provider !== undefined &&
        !['r2', 's3', 'spaces'].includes(values.provider)
      ) {
        add('provider', 'Choose a supported storage provider.')
      }
    }
    for (const [field, label] of [
      ['accessKey', 'Access key'],
      ['secretKey', 'Secret key'],
      ['bucket', 'Bucket'],
      ['region', 'Region'],
      ['endpoint', 'Endpoint URL']
    ]) {
      validateRequired(field, label)
    }

    if (
      shouldCheck('accessKey') &&
      !isMissing(values.accessKey) &&
      /\s/.test(values.accessKey)
    ) {
      add('accessKey', 'Access key cannot contain whitespace.')
    }
    if (
      shouldCheck('secretKey') &&
      !isMissing(values.secretKey) &&
      /\s/.test(values.secretKey)
    ) {
      add('secretKey', 'Secret key cannot contain whitespace.')
    }
    if (shouldCheck('bucket') && !isMissing(values.bucket)) {
      const bucket = String(values.bucket).trim()
      if (
        bucket.length < 3 ||
        bucket.length > 63 ||
        !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket) ||
        bucket.includes('..') ||
        /\.-|-\./.test(bucket) ||
        net.isIP(bucket)
      ) {
        add(
          'bucket',
          'Enter a valid bucket name using lowercase letters, numbers, dots, or hyphens.'
        )
      }
    }
    if (
      shouldCheck('region') &&
      !isMissing(values.region) &&
      !/^[a-z0-9][a-z0-9-]{0,62}$/.test(String(values.region).trim())
    ) {
      add('region', 'Enter a valid storage region.')
    }

    if (shouldCheck('backupSchedule') && values.backupSchedule !== undefined) {
      const schedule = values.backupSchedule || {}
      if (schedule.enabled) {
        if (
          shouldCheck('backupSchedule.intervalHours') &&
          (!Number.isInteger(Number(schedule.intervalHours)) ||
            Number(schedule.intervalHours) < 1 ||
            Number(schedule.intervalHours) > 8760)
        ) {
          add(
            'backupSchedule.intervalHours',
            'Backup interval must be between 1 and 8760 hours.'
          )
        }
        if (
          shouldCheck('backupSchedule.retentionCount') &&
          (!Number.isInteger(Number(schedule.retentionCount)) ||
            Number(schedule.retentionCount) < 1 ||
            Number(schedule.retentionCount) > 1000)
        ) {
          add(
            'backupSchedule.retentionCount',
            'Retention must be between 1 and 1000 backups.'
          )
        }
      }
    }

    if (
      shouldCheck('role') &&
      values.role !== undefined &&
      !['admin', 'member'].includes(values.role)
    ) {
      add('role', 'Choose a valid team role.')
    }

    if (shouldCheck('scopes') && values.scopes !== undefined) {
      if (
        !Array.isArray(values.scopes) ||
        !values.scopes.length ||
        values.scopes.some((scope) => scope !== 'deploy')
      ) {
        add('scopes', 'Choose a valid deploy token scope.')
      }
    }
    if (shouldCheck('expiresInDays') && !isMissing(values.expiresInDays)) {
      const expiresInDays = Number(values.expiresInDays)
      if (
        !Number.isInteger(expiresInDays) ||
        expiresInDays < 1 ||
        expiresInDays > 3650
      ) {
        add(
          'expiresInDays',
          'Token expiration must be between 1 and 3650 days.'
        )
      }
    }

    return problems
  }
}
