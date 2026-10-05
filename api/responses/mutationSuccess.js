/** Keep page mutations on their current Inertia page; preserve the REST contract. */
module.exports = function mutationSuccess(data, options = {}) {
  if (!this.req.header?.('X-Inertia'))
    return this.res.status(options.statusCode || 200).json(data)
  return this.res
    .status(303)
    .set(
      'Location',
      options.location || require('../lib/mutation-return-path')(this.req)
    )
    .send('See Other')
}
