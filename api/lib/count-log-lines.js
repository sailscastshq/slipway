// Match split('\n').filter(line => line.trim()).length without retaining an
// array and substring for every line in a noisy container's log window.
module.exports = function countLogLines(value) {
  let count = 0
  let start = 0
  let end
  while ((end = value.indexOf('\n', start)) !== -1) {
    if (/\S/.test(value.slice(start, end))) count++
    start = end + 1
  }
  if (/\S/.test(value.slice(start))) count++
  return count
}
