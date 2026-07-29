/**
 * HelmSnippet.js
 *
 * Named Helm source that can be inserted into the editor without executing it.
 */

module.exports = {
  tableName: 'helm_snippets',

  attributes: {
    name: {
      type: 'string',
      required: true,
      maxLength: 100
    },

    source: {
      type: 'string',
      required: true,
      columnType: 'text'
    },

    scope: {
      type: 'string',
      isIn: ['personal', 'project'],
      defaultsTo: 'personal'
    },

    owner: {
      model: 'user',
      required: true
    },

    team: {
      model: 'team',
      required: true
    },

    project: {
      model: 'project',
      required: true
    }
  }
}
