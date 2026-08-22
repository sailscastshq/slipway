const { renderErrorPage } = require('../lib/error-pages')

module.exports = function errorPage(options = {}) {
  return renderErrorPage(this.req, this.res, options)
}
