function normalizeMediaPreview(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['type', 'title', 'url'].includes(key)) ||
    !['video', 'pdf'].includes(value.type) ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 512 ||
    typeof value.url !== 'string' ||
    value.url.length > 2048 ||
    !/^\/(?!\/)[A-Za-z0-9/_~.-]+$/.test(value.url) ||
    value.url
      .split('/')
      .slice(1)
      .some((segment) => !segment || ['.', '..'].includes(segment))
  )
    return null
  return {
    type: value.type,
    title: value.title.trim().slice(0, 120),
    url: value.url
  }
}
module.exports = { normalizeMediaPreview }
