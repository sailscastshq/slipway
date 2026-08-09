const { test } = require('sounding')

const { isMissingContainerError } =
  require('../../../../api/helpers/docker/get-container-status')._private

test('Docker lowercase no-such-object output is a normal missing container', ({
  expect
}) => {
  const error = new Error(
    'Command failed: docker inspect candidate error: no such object: candidate'
  )
  error.stderr = 'error: no such object: candidate'

  expect(isMissingContainerError(error)).toBe(true)
})

test('Docker no-such-container output is a normal missing container', ({
  expect
}) => {
  expect(
    isMissingContainerError(new Error('Error: No such container: candidate'))
  ).toBe(true)
})

test('unrelated Docker failures remain fatal', ({ expect }) => {
  expect(isMissingContainerError(new Error('Docker socket unavailable'))).toBe(
    false
  )
})
