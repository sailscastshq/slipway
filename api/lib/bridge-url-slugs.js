const RESERVED = new Set([
  'new',
  'create',
  'edit',
  'update',
  'delete',
  'bulk-delete',
  'actions',
  'relationships',
  'launch',
  '_assets',
  'support',
  'login',
  'logout',
  'view',
  'view-any'
])

function kebab(value) {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
}
function slugFor(identity, configured) {
  const slug = configured === undefined ? kebab(identity) : configured
  if (
    typeof slug !== 'string' ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) ||
    RESERVED.has(slug)
  ) {
    throw new Error(`Bridge URL slug "${String(slug)}" is invalid or reserved.`)
  }
  return slug
}
function assertUnique(entries, label) {
  const routes = new Map()
  for (const [identity, slug] of entries) {
    for (const route of new Set([identity, slug])) {
      if (routes.has(route) && routes.get(route) !== identity)
        throw new Error(
          `Bridge ${label} URL slug "${route}" collides with "${routes.get(
            route
          )}".`
        )
      routes.set(route, identity)
    }
  }
}
module.exports = { slugFor, assertUnique }
