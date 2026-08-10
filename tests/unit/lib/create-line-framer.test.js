const { test } = require('sounding')
const createLineFramer = require('../../../api/lib/create-line-framer')

test('Docker output is emitted only after a complete line arrives', ({
  expect
}) => {
  const lines = []
  const framer = createLineFramer({ onLine: (line) => lines.push(line) })

  framer.write(Buffer.from('2026-08-04T14:03:12Z Error: EMA'))
  framer.write(Buffer.from('XBUFFER\n    at Timeout.'))

  expect(lines).toEqual(['2026-08-04T14:03:12Z Error: EMAXBUFFER'])

  framer.end(Buffer.from('<anonymous>'))
  expect(lines).toEqual([
    '2026-08-04T14:03:12Z Error: EMAXBUFFER',
    '    at Timeout.<anonymous>'
  ])
})

test('Docker output preserves blank lines, CRLF, and split UTF-8 bytes', ({
  expect
}) => {
  const lines = []
  const framer = createLineFramer({ onLine: (line) => lines.push(line) })
  const output = Buffer.from('ready 🌊\r\n\r\nnext\n')

  framer.write(output.subarray(0, 8))
  framer.write(output.subarray(8, 11))
  framer.end(output.subarray(11))

  expect(lines).toEqual(['ready 🌊', '', 'next'])
})
