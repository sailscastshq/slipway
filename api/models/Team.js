/**
 * Team.js
 *
 * A team is the primary organizational unit in Slipway.
 * Projects belong to teams, and users are members of teams.
 */

module.exports = {
  tableName: 'teams',

  attributes: {
    name: {
      type: 'string',
      required: true,
      description: 'Team name',
      example: 'Acme Corp'
    },

    slug: {
      type: 'string',
      unique: true,
      description: 'URL-safe identifier (auto-generated from name)',
      example: 'acme-corp',
      regex: /^[a-z0-9-]+$/
    },

    // The team owner (genesis user for default team)
    owner: {
      model: 'user',
      required: true
    },

    // Team members (users who belong to this team)
    members: {
      collection: 'user',
      via: 'team'
    },

    // Projects owned by this team
    projects: {
      collection: 'project',
      via: 'team'
    },

    // Team logo (stored in S3-compatible storage)
    logoUrl: {
      type: 'string',
      columnName: 'logo_url',
      description: 'URL to team logo image'
    }
  },

  afterCreate: async function (team, proceed) {
    try {
      await TeamMembership.findOrCreate(
        { key: `${team.owner}:${team.id}` },
        {
          key: `${team.owner}:${team.id}`,
          user: team.owner,
          team: team.id,
          role: 'owner'
        }
      )
      return proceed()
    } catch (error) {
      return proceed(error)
    }
  },
  afterDestroy: async function (team, proceed) {
    try {
      await TeamMembership.destroy({ team: team.id })
      await CliToken.destroy({ team: team.id })
      return proceed()
    } catch (error) {
      return proceed(error)
    }
  },
  beforeCreate: async function (values, proceed) {
    if (!values.slug && values.name) {
      values.slug = values.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
    }
    return proceed()
  }
}
