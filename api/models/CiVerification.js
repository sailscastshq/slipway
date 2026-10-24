module.exports = {
  tableName: 'ci_verifications',
  attributes: {
    deployment: {
      model: 'deployment',
      required: true,
      unique: true
    },
    app: {
      model: 'app',
      required: true
    },
    run: {
      model: 'cirun',
      required: true
    },
    policyRevision: {
      type: 'string',
      required: true,
      columnName: 'policy_revision'
    },
    imageId: {
      type: 'string',
      required: true,
      columnName: 'image_id'
    },
    commit: {
      type: 'string',
      required: true
    },
    runtimeRevision: {
      type: 'string',
      required: true,
      columnName: 'runtime_revision'
    },
    verifiedAt: {
      type: 'number',
      required: true,
      columnName: 'verified_at'
    }
  }
}
