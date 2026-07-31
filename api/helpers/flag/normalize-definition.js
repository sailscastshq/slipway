const TARGET_PATTERN = /^(user|account|tenant|team):([^\s].{0,119})$/

module.exports = {
  friendlyName: 'Normalize release flag definition',

  description:
    'Validate and normalize the small boolean release flag contract.',

  sync: true,

  inputs: {
    values: { type: 'ref', required: true },
    requireKey: { type: 'boolean', defaultsTo: false }
  },

  exits: {
    success: { outputType: 'ref' }
  },

  fn: function ({ values, requireKey }) {
    const problems = []
    const normalized = {}

    if (requireKey || values.key !== undefined) {
      const key = String(values.key || '')
        .trim()
        .toLowerCase()
      if (!/^[a-z][a-z0-9-]{0,63}$/.test(key)) {
        problems.push({
          key: 'Use 1–64 lowercase letters, numbers, and hyphens, beginning with a letter.'
        })
      } else {
        normalized.key = key
      }
    }

    const description = String(values.description || '').trim()
    if (description.length > 160) {
      problems.push({
        description: 'Description must be 160 characters or fewer.'
      })
    } else {
      normalized.description = description || null
    }

    if (typeof values.enabled !== 'boolean') {
      problems.push({ enabled: 'Enabled must be true or false.' })
    } else {
      normalized.enabled = values.enabled
    }

    const rolloutPercentage = Number(values.rolloutPercentage)
    if (
      !Number.isInteger(rolloutPercentage) ||
      rolloutPercentage < 0 ||
      rolloutPercentage > 100
    ) {
      problems.push({
        rolloutPercentage:
          'Rollout percentage must be a whole number from 0 to 100.'
      })
    } else {
      normalized.rolloutPercentage = rolloutPercentage
    }

    if (!Array.isArray(values.targets)) {
      problems.push({ targets: 'Allowlist targets must be an array.' })
    } else if (values.targets.length > 100) {
      problems.push({
        targets: 'A flag can have at most 100 allowlist targets.'
      })
    } else {
      const targets = []
      for (const rawTarget of values.targets) {
        const target = String(rawTarget || '').trim()
        const match = target.match(TARGET_PATTERN)
        if (!match) {
          problems.push({
            targets:
              'Use typed targets such as user:42, account:acme, tenant:north, or team:staff.'
          })
          break
        }
        const normalizedTarget = `${match[1]}:${match[2].trim()}`
        if (!targets.includes(normalizedTarget)) targets.push(normalizedTarget)
      }
      normalized.targets = targets.sort()
    }

    return { values: normalized, problems }
  }
}
