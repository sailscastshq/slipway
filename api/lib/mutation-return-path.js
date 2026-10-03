module.exports = function mutationReturnPath(req) {
  const referrer = req.get('Referrer')
  if (!referrer) return '/'
  try {
    const origin = `${req.protocol || 'http'}://${req.get('host')}`
    const url = new URL(referrer, origin)
    if (url.origin !== origin) return '/'
    return `${url.pathname}${url.search}`
  } catch {
    return '/'
  }
}
