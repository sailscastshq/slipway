const crypto = require('node:crypto')

function slugifyUpdateTitle(value) {
  return (
    String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 160) || 'update'
  )
}

async function createUpdateSlug({ title, spaceId }) {
  const base = slugifyUpdateTitle(title)
  const existing = await BearingUpdate.find({
    space: spaceId,
    slug: { startsWith: base }
  })
    .select(['slug'])
    .limit(100)
  const used = new Set(existing.map((item) => item.slug).filter(Boolean))

  if (!used.has(base)) return base
  for (let suffix = 2; suffix <= 100; suffix += 1) {
    const candidate = `${base.slice(0, 154)}-${suffix}`
    if (!used.has(candidate)) return candidate
  }

  return `${base.slice(0, 151)}-${crypto.randomBytes(4).toString('hex')}`
}

module.exports = { createUpdateSlug, slugifyUpdateTitle }
