module.exports = {
  friendlyName: 'Review Infrastructure disk cleanup',
  fn: async function () {
    return sails.helpers.buildCacheRetention.getReview()
  }
}
