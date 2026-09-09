const forbidden =
  /(?:^|[\/_-])(auth|login|logout|password|email|mfa|passkey|recovery|security|token|api-key|oauth|webhook|billing|payment|purchase|refund|payout|bank|export|download|delete|role|permission|ownership|impersonation|job|command)(?:[\/_-]|$)/i
const blockedKeys = new Set(['__proto__', 'prototype', 'constructor'])
function configuration(sails) {
  const slipway = sails.config.slipway || {}
  const config = slipway.bridge?.impersonation || {}
  const mapping = {
    model: 'user',
    sessionKey: 'userId',
    idAttribute: 'id',
    nameAttribute: 'fullName',
    ...slipway.identity,
    ...config,
    helper: config.helper
  }
  for (const value of [mapping.model, mapping.sessionKey, mapping.idAttribute])
    if (
      typeof value !== 'string' ||
      !/^[a-zA-Z][\w]*$/.test(value) ||
      blockedKeys.has(value)
    )
      throw Error('Invalid support identity configuration.')
  if (
    config.enabled &&
    (!Array.isArray(mapping.readOnlyPaths) ||
      !mapping.readOnlyPaths.length ||
      mapping.readOnlyPaths.length > 100 ||
      mapping.readOnlyPaths.some(
        (value) =>
          typeof value !== 'string' ||
          !value.startsWith('/') ||
          value.startsWith('//') ||
          /[\\?#%\x00-\x20]/.test(value) ||
          value.includes('..')
      ))
  )
    throw Error('Declare the exact read-only support paths.')
  return {
    ...mapping,
    model: mapping.model.toLowerCase(),
    enabled: config.enabled === true
  }
}
function approvedRequest(req, sails) {
  if (!['GET', 'HEAD'].includes(req.method)) return false
  let pathname
  try {
    pathname = decodeURIComponent(String(req.path || req.url).split('?')[0])
  } catch {
    return false
  }
  if (
    forbidden.test(pathname) ||
    pathname.includes('..') ||
    pathname.includes('\\')
  )
    return false
  // GET is not a promise of read-only behavior. The app explicitly declares the
  // screens it has reviewed; an unknown route can never inherit support access.
  const routes = configuration(sails).readOnlyPaths
  return (
    Array.isArray(routes) &&
    routes.length <= 100 &&
    routes.some(
      (path) =>
        typeof path === 'string' && path.startsWith('/') && path === pathname
    )
  )
}
function protectedTarget(target) {
  if (
    !target ||
    target.deletedAt ||
    target.suspendedAt ||
    target.disabledAt ||
    target.isAdmin ||
    target.isSuperAdmin ||
    target.isSystem ||
    target.isServiceAccount
  )
    return true
  if (['deleted', 'disabled', 'suspended', 'banned'].includes(target.status))
    return true
  return [
    target.role,
    ...(Array.isArray(target.roles) ? target.roles : [])
  ].some((role) =>
    /^(owner|admin|administrator|superadmin|system|service)$/i.test(
      String(role || '')
    )
  )
}
module.exports = { configuration, approvedRequest, protectedTarget }
