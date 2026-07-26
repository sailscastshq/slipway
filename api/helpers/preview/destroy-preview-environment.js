module.exports = {
  friendlyName: 'Destroy preview environment',

  description:
    'Use shared cleanup to purge an automatically-created preview environment.',

  inputs: {
    project: {
      type: 'ref',
      required: true,
      description: 'Project record'
    },
    prNumber: {
      type: 'number',
      required: true,
      description: 'Pull request number'
    }
  },

  exits: {
    success: {
      description: 'Preview environment destroyed',
      outputType: 'ref'
    }
  },

  fn: async function ({ project, prNumber }) {
    const slug = `pr-${prNumber}`
    const requestKey = `environment:${project.slug}/${slug}`
    const environment = await Environment.findOne({
      project: project.id,
      slug
    })
    const targetKey = environment ? `environment:${environment.id}` : undefined
    const existingOperation = await sails.helpers.cleanup.findOperation.with({
      targetKey,
      requestKey
    })

    if (!environment && !existingOperation) {
      sails.log.verbose(
        `No preview environment ${slug} found for ${project.slug}`
      )
      return { status: 'not_found' }
    }

    const cleanup = await sails.helpers.cleanup.run.with({
      targetKey: targetKey || existingOperation.targetKey,
      requestKey,
      scopeType: 'environment',
      resourceId: environment?.id || existingOperation.resourceId,
      retentionPolicy: 'purge',
      teamId: normalizeId(project.team) || normalizeId(existingOperation.team),
      ipAddress: null
    })

    sails.log.info(`Preview environment destroyed: ${project.slug}/${slug}`)
    return cleanup
  }
}

function normalizeId(value) {
  return value && typeof value === 'object' ? value.id : value
}
