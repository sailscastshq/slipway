module.exports = function serverError(error) {
  return this.res.errorPage({ statusCode: 500, error })
}
