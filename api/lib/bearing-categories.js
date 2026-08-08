const DEFAULT_BEARING_CATEGORIES = Object.freeze([
  { key: 'feature', label: 'Feature', active: true },
  { key: 'bug', label: 'Bug', active: true }
])

function normalizeBearingCategories(value) {
  const source = Array.isArray(value) ? value : DEFAULT_BEARING_CATEGORIES
  const seen = new Set()
  const categories = []

  for (const candidate of source.slice(0, 6)) {
    const label = String(candidate?.label || '')
      .trim()
      .slice(0, 24)
    const key = String(candidate?.key || slug(label))
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 40)
    if (!key || !label || seen.has(key)) continue
    seen.add(key)
    categories.push({ key, label, active: candidate.active !== false })
  }

  if (!categories.length) {
    return DEFAULT_BEARING_CATEGORIES.map((category) => ({ ...category }))
  }
  if (!categories.some((category) => category.active))
    categories[0].active = true
  return categories
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

module.exports = { DEFAULT_BEARING_CATEGORIES, normalizeBearingCategories }
