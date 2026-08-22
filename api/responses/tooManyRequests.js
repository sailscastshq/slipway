module.exports = function tooManyRequests(options = {}) {
  return this.res.errorPage({
    statusCode: 429,
    error: options.error,
    retryAfter: options.retryAfter
  })
}
