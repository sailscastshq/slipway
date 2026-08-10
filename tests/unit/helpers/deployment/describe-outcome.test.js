const { test } = require('sounding')

test('deployment outcomes separate traffic ownership from lifecycle status', ({
  sails,
  expect
}) => {
  const describe = (deployment, currentDeploymentIds = []) =>
    sails.helpers.deployment.describeOutcome.with({
      deployment,
      currentDeploymentIds
    })

  expect(describe({ id: 42, status: 'running' }, [42])).toEqual({
    status: 'running',
    outcome: 'succeeded',
    outcomeLabel: 'Succeeded',
    isCurrent: true,
    isActive: false
  })

  expect(describe({ id: 41, status: 'running' }, [42])).toEqual({
    status: 'running',
    outcome: 'succeeded',
    outcomeLabel: 'Succeeded',
    isCurrent: false,
    isActive: false
  })

  expect(describe({ id: 43, status: 'pushing' }, [42])).toEqual({
    status: 'pushing',
    outcome: 'in-progress',
    outcomeLabel: 'Publishing',
    isCurrent: false,
    isActive: true
  })
})
