// Only server-owned control-plane records establish diagnostic identity.
// Configuration maps, URL paths, and arbitrary log text never grant provenance.
const fields = {
  project: ['id', 'name', 'slug'],
  environment: ['id', 'name', 'slug'],
  app: ['id', 'name', 'slug'],
  gitrepository: ['id', 'owner', 'name', 'fullName', 'htmlUrl'],
  user: ['id', 'email', 'fullName']
}
function fromRecord(kind, record) {
  if (!record?.id || !fields[kind]) return []
  if (kind === 'gitrepository') {
    if (
      typeof record.owner !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(record.owner) ||
      typeof record.name !== 'string' ||
      !/^[a-z0-9_.-]{1,100}$/i.test(record.name) ||
      ['.', '..'].includes(record.name) ||
      record.fullName !== `${record.owner}/${record.name}` ||
      (record.htmlUrl != null &&
        record.htmlUrl !== `https://github.com/${record.fullName}`)
    )
      return []
    return [record.owner, record.name, record.fullName]
  }
  if (kind === 'user') {
    if (
      typeof record.email !== 'string' ||
      record.email.length > 200 ||
      !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
        record.email
      )
    )
      return []
    return [record.email, record.email.slice(record.email.lastIndexOf('@') + 1)]
  }
  if (
    typeof record.slug !== 'string' ||
    !/^[a-z0-9-]{1,128}$/.test(record.slug)
  )
    return []
  const name =
    typeof record.name === 'string' &&
    /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,127}$/.test(record.name)
      ? record.name
      : null
  return [record.slug, ...(name ? [name] : [])]
}
module.exports = { fields, fromRecord }
