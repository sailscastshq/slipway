module.exports = function pageExpired(error) {
  return this.res.errorPage({ statusCode: 419, error })
}
