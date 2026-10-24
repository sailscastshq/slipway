const transitions = {
  queued: ['preparing', 'cancelled', 'timed-out'],
  preparing: ['running', 'failed', 'cancelled', 'timed-out', 'interrupted'],
  running: ['passed', 'failed', 'cancelled', 'timed-out', 'interrupted']
}

module.exports = {
  friendlyName: 'Transition Trials run',
  description:
    'Validate an immutable state transition; persistence must fence this with a runner lease.',
  inputs: {
    run: { type: 'ref', required: true },
    nextState: { type: 'string', required: true },
    now: { type: 'number', required: true }
  },
  exits: { success: { outputType: 'ref' } },
  fn: async function ({ run, nextState, now }) {
    if (!Number.isSafeInteger(now) || now < 0)
      throw new Error('A valid transition time is required.')
    if (!(transitions[run.state] || []).includes(nextState))
      throw new Error(
        `Trials cannot transition from ${run.state} to ${nextState}.`
      )
    if (nextState === 'passed') {
      if (!Array.isArray(run.steps) || !run.steps.some((step) => step.required))
        throw new Error('A run without required checks cannot pass.')
      if (run.steps.some((step) => step.required && step.state !== 'passed'))
        throw new Error('Every required step must have passed.')
      if (
        run.cancelRequestedAt != null ||
        !Number.isSafeInteger(run.lease?.expiresAt) ||
        run.lease.expiresAt <= now
      )
        throw new Error(
          'A cancelled run or an expired runner lease cannot pass.'
        )
      if (
        !/^[a-f0-9]{40}$/.test(run.identity?.commit || '') ||
        !/^sha256:[a-f0-9]{64}$/.test(run.identity?.configRevision || '') ||
        run.identity.commit !== run.observedCommit ||
        run.identity.configRevision !== run.observedConfigRevision
      )
        throw new Error(
          'The observed source and configuration must match the admitted run.'
        )
    }
    const terminal = !Object.hasOwn(transitions, nextState)
    return {
      ...run,
      state: nextState,
      updatedAt: now,
      ...(nextState === 'running' ? { startedAt: now } : {}),
      ...(terminal ? { finishedAt: now } : {})
    }
  }
}
