const { test } = require('sounding')
const {
  getHelmCompletions
} = require('../../../../api/lib/helm-completion-cache')

test('Helm shares completion discovery for one deployment but reloads for another', async ({
  expect
}) => {
  let calls = 0
  const load = async () => {
    calls++
    return { available: true, models: [{ globalId: 'User' }] }
  }

  const [first, concurrent] = await Promise.all([
    getHelmCompletions('test-app-deployment-1', load),
    getHelmCompletions('test-app-deployment-1', load)
  ])
  const reused = await getHelmCompletions('test-app-deployment-1', load)
  const redeployed = await getHelmCompletions('test-app-deployment-2', load)

  expect(calls).toBe(2)
  expect(first).toEqual(concurrent)
  expect(reused).toEqual(first)
  expect(redeployed).toEqual(first)
})

test('Helm retries unavailable completion metadata instead of caching it', async ({
  expect
}) => {
  let calls = 0
  const load = async () => {
    calls++
    return { available: calls > 1, models: [] }
  }

  expect((await getHelmCompletions('test-unavailable', load)).available).toBe(
    false
  )
  expect((await getHelmCompletions('test-unavailable', load)).available).toBe(
    true
  )
  expect(calls).toBe(2)
})
