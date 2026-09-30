// Follow a successful composer save as an Inertia GET, preserving client edits.
module.exports = function bearingUpdateRedirect(url) {
  return this.res.status(303).set('Location', url).send('See Other')
}
