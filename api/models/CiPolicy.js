module.exports = {
  tableName: 'ci_policies',
  attributes: {
    app: {
      model: 'app',
      required: true,
      unique: true
    },
    revision: {
      type: 'string',
      required: true
    },
    repositoryId: {
      type: 'string',
      required: true,
      columnName: 'repository_id'
    },
    branch: {
      type: 'string',
      required: true
    },
    configuration: {
      type: 'json',
      required: true
    },
    enabled: {
      type: 'boolean',
      defaultsTo: false
    },
    createdBy: {
      model: 'user',
      required: true,
      columnName: 'created_by'
    }
  }
}
