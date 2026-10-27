module.exports = function appAppearanceLogo(logo) {
  if (!logo?.data) return this.res.notFound()
  this.res.set('Content-Type', 'image/webp')
  this.res.set('X-Content-Type-Options', 'nosniff')
  this.res.set('Cache-Control', 'private, no-cache')
  return this.res.send(Buffer.from(logo.data, 'base64'))
}
