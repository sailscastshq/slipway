/** Creation endpoints retain their 201 JSON receipt for REST callers. */
module.exports = function mutationCreated(data) {
  return require('./mutationSuccess').call(this, data, { statusCode: 201 })
}
