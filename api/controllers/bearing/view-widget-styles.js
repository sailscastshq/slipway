const fs = require('node:fs')
const path = require('node:path')
const source = fs.readFileSync(
  path.resolve(__dirname, '../../../assets/css/bearing-widget.css'),
  'utf8'
)
module.exports = {
  friendlyName: 'View Bearing widget stylesheet',
  inputs: {
    projectSlug: { type: 'string', required: true },
    environmentSlug: { type: 'string', required: true },
    appSlug: { type: 'string', required: true }
  },
  fn: async function () {
    this.res.set('Content-Type', 'text/css; charset=utf-8')
    this.res.set('Cache-Control', 'public, max-age=300')
    this.res.set('X-Content-Type-Options', 'nosniff')
    return source
  }
}
