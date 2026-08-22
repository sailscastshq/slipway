module.exports = function serviceUnavailable(error) {
  return this.res.errorPage({ statusCode: 503, error })
}
