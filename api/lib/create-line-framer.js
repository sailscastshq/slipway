const { StringDecoder } = require('node:string_decoder')

module.exports = function createLineFramer({ onLine }) {
  if (typeof onLine !== 'function') {
    throw new TypeError('createLineFramer requires an onLine function.')
  }

  const decoder = new StringDecoder('utf8')
  let remainder = ''
  let ended = false

  function emitCompleteLines(text) {
    remainder += text

    let newlineIndex = remainder.indexOf('\n')
    while (newlineIndex !== -1) {
      let line = remainder.slice(0, newlineIndex)
      remainder = remainder.slice(newlineIndex + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      onLine(line)
      newlineIndex = remainder.indexOf('\n')
    }
  }

  return {
    write(chunk) {
      if (ended) return
      emitCompleteLines(decoder.write(chunk))
    },

    end(chunk) {
      if (ended) return
      ended = true
      emitCompleteLines(
        chunk === undefined ? decoder.end() : decoder.end(chunk)
      )

      if (remainder.length > 0) {
        let line = remainder
        remainder = ''
        if (line.endsWith('\r')) line = line.slice(0, -1)
        onLine(line)
      }
    }
  }
}
