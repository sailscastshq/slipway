/**
 * cli/auth-sessions.js
 *
 * @description :: In-memory storage for CLI authentication sessions.
 *                 These are short-lived (5 min) and don't need persistence.
 */

// In-memory store for pending CLI auth sessions
const sessions = new Map()

// Keep stale auth codes from piling up without pinning the test process open.
const cleanupInterval = setInterval(() => {
  const now = Date.now()
  for (const [code, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(code)
    }
  }
}, 60 * 1000) // Every minute

if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref()
}

module.exports = {
  friendlyName: 'CLI auth sessions',

  description: 'Manage in-memory CLI authentication sessions.',

  sync: true,

  inputs: {},

  fn: function () {
    return {
      /**
       * Create a new pending auth session
       * @returns {{ code: string, expiresAt: number }}
       */
      create() {
        // Generate 8-character code (avoiding ambiguous chars)
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
        let code = ''
        for (let i = 0; i < 8; i++) {
          code += chars[Math.floor(Math.random() * chars.length)]
        }

        const expiresAt = Date.now() + 5 * 60 * 1000 // 5 minutes

        sessions.set(code, {
          status: 'pending',
          expiresAt,
          user: null,
          sessionToken: null
        })

        return { code, expiresAt }
      },

      /**
       * Get a session by code
       * @param {string} code
       * @returns {object|null}
       */
      get(code) {
        const session = sessions.get(code)
        if (!session) return null
        if (session.expiresAt < Date.now()) {
          sessions.delete(code)
          return null
        }
        return session
      },

      /**
       * Confirm a session (called when user authenticates in browser)
       * @param {string} code
       * @param {object} user
       * @param {string} sessionToken
       * @returns {boolean}
       */
      confirm(code, user, sessionToken) {
        const session = sessions.get(code)
        if (!session || session.expiresAt < Date.now()) {
          return false
        }

        session.status = 'authenticated'
        session.user = user
        session.sessionToken = sessionToken
        return true
      },

      /**
       * Delete a session
       * @param {string} code
       */
      delete(code) {
        sessions.delete(code)
      }
    }
  }
}
