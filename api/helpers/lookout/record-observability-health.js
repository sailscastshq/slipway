module.exports = {
  friendlyName: 'Record observability health',

  description:
    'Persist the latest collector or retention job result for operator visibility.',

  inputs: {
    jobName: {
      type: 'string',
      isIn: ['collector', 'retention'],
      required: true
    },
    succeeded: {
      type: 'boolean',
      required: true
    },
    attemptedAt: {
      type: 'number',
      required: true
    },
    completedAt: {
      type: 'number',
      required: true
    },
    rowCount: {
      type: 'number',
      allowNull: true
    },
    details: {
      type: 'ref',
      defaultsTo: {}
    },
    error: {
      type: 'string',
      allowNull: true
    }
  },

  fn: async function ({
    jobName,
    succeeded,
    attemptedAt,
    completedAt,
    rowCount,
    details,
    error
  }) {
    const existing = await ObservabilityJobHealth.findOne({ jobName })
    const values = {
      lastAttemptAt: attemptedAt,
      lastDurationMs: Math.max(0, completedAt - attemptedAt),
      details: details || {}
    }

    if (Number.isFinite(rowCount)) values.rowCount = rowCount

    if (succeeded) {
      values.lastSuccessAt = completedAt
      values.lastError = null
    } else {
      values.lastFailureAt = completedAt
      values.lastError = String(error || 'Unknown error').slice(0, 2000)
    }

    if (existing) {
      return await ObservabilityJobHealth.updateOne({ id: existing.id }).set(
        values
      )
    }

    try {
      return await ObservabilityJobHealth.create({
        jobName,
        rowCount: Number.isFinite(rowCount) ? rowCount : 0,
        ...values
      }).fetch()
    } catch (createError) {
      const raced = await ObservabilityJobHealth.findOne({ jobName })
      if (!raced) throw createError
      return await ObservabilityJobHealth.updateOne({ id: raced.id }).set(
        values
      )
    }
  }
}
