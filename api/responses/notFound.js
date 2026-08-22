module.exports = function notFound(error) {
  return this.res.errorPage({ statusCode: 404, error })
}
