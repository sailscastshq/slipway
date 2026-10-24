module.exports = {
  tableName: 'ci_runners',
  attributes: {
    runnerId: {
      type: 'string',
      required: true,
      unique: true,
      columnName: 'runner_id'
    },
    app: {
      model: 'app',
      required: true
    },
    name: {
      type: 'string',
      required: true,
      maxLength: 80
    },
    publicKey: {
      type: 'string',
      required: true,
      columnName: 'public_key'
    },
    policyRevision: {
      type: 'string',
      required: true,
      columnName: 'policy_revision'
    },
    approvedBy: {
      model: 'user',
      required: true,
      columnName: 'approved_by'
    },
    revokedAt: {
      type: 'number',
      allowNull: true,
      columnName: 'revoked_at'
    }
  }
}
