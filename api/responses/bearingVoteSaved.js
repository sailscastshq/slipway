/** A public vote receipt remains available even if ranking moves the item. */
module.exports = function bearingVoteSaved(data) {
  if (this.req.header?.('X-Inertia'))
    this.req._sails.inertia.flash('vote', {
      publicId: data.feedback.publicId,
      voted: data.voted,
      voteCount: data.voteCount
    })
  return require('./mutationSuccess').call(this, data)
}
