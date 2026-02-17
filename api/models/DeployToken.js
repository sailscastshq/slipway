/**
 * DeployToken.js
 *
 * API tokens for CI/CD deployments.
 */

module.exports = {
  tableName: 'deploy_tokens',
  attributes: {
    // Token identifier
    name: {
      type: 'string',
      required: true,
      description: 'Human-readable name (e.g., "GitHub Actions")'
    },

    // The token prefix (visible) + hash (for lookup)
    tokenPrefix: {
      type: 'string',
      required: true,
      description: 'First 12 chars of token (slp_live_xxx)'
    },

    tokenHash: {
      type: 'string',
      required: true,
      description: 'SHA-256 hash of full token for verification'
    },

    // Permissions
    scopes: {
      type: 'json',
      defaultsTo: ['deploy'],
      description:
        'Allowed actions: deploy, logs, env:read, env:write, rollback'
    },

    // Usage tracking
    lastUsedAt: {
      type: 'number',
      allowNull: true
    },

    lastUsedIp: {
      type: 'string',
      allowNull: true
    },

    usageCount: {
      type: 'number',
      defaultsTo: 0
    },

    // Expiration
    expiresAt: {
      type: 'number',
      allowNull: true,
      description: 'Unix timestamp for expiration (null = never)'
    },

    // Status
    isActive: {
      type: 'boolean',
      defaultsTo: true
    },

    revokedAt: {
      type: 'number',
      allowNull: true
    },

    revokedBy: {
      model: 'user'
    },

    // Relationships
    project: {
      model: 'project',
      description: 'Scoped to specific project (null = all projects)'
    },

    environment: {
      model: 'environment',
      description: 'Scoped to specific environment (null = all environments)'
    },

    createdBy: {
      model: 'user',
      required: true
    },

    team: {
      model: 'team',
      required: true
    }
  },

  // Generate a new deploy token
  generateToken: async function (attrs) {
    const crypto = require('crypto')

    // Generate random token: slp_live_<32 random chars>
    const randomPart = crypto.randomBytes(24).toString('base64url')
    const token = `slp_live_${randomPart}`

    // Hash for storage (never store plain token)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    // Create record
    const record = await DeployToken.create({
      ...attrs,
      tokenPrefix: token.substring(0, 12),
      tokenHash
    }).fetch()

    // Return token (only time it's visible in plain text)
    return {
      ...record,
      token // Plain text token - show once, never stored
    }
  },

  // Verify a token and return the record if valid
  verifyToken: async function (token) {
    const crypto = require('crypto')

    if (!token || !token.startsWith('slp_live_')) {
      return null
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const record = await DeployToken.findOne({
      tokenHash,
      isActive: true
    })
      .populate('project')
      .populate('environment')
      .populate('team')

    if (!record) {
      return null
    }

    // Check expiration
    if (record.expiresAt && Date.now() > record.expiresAt) {
      return null
    }

    // Update usage stats asynchronously
    DeployToken.updateOne({ id: record.id })
      .set({
        lastUsedAt: Date.now(),
        usageCount: record.usageCount + 1
      })
      .meta({ fetch: false })

    return record
  },

  // Check if token has required scope
  hasScope: function (token, requiredScope) {
    if (!token || !token.scopes) return false
    return token.scopes.includes(requiredScope) || token.scopes.includes('*')
  }
}
