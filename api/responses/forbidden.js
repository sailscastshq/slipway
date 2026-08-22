module.exports = function forbidden(error) {
  return this.res.errorPage({ statusCode: 403, error })
}
