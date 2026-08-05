const { test } = require('sounding')

test('Bridge workspace navigation exposes only authorized resources and global dashboards', async ({
  sails,
  expect
}) => {
  const navigation = await sails.helpers.bridge.buildWorkspaceNavigation.with({
    actor: {
      id: 'host-user-7',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      role: 'administrator',
      bridgeRole: 'administrator',
      teamId: 'private-team-id'
    },
    contract: {
      dashboards: {
        overview: {
          id: 'overview',
          label: 'Content overview',
          scope: 'environment',
          default: true
        },
        courseHealth: {
          id: 'courseHealth',
          label: 'Course health',
          scope: 'resource',
          resource: 'course'
        }
      }
    },
    authorizedResources: {
      lesson: {
        identity: 'lesson',
        label: 'Lessons',
        singularLabel: 'Lesson',
        actions: { viewAny: true }
      },
      course: {
        identity: 'course',
        label: 'Courses',
        singularLabel: 'Course',
        actions: { viewAny: true }
      },
      secret: {
        identity: 'secret',
        label: 'Secrets',
        singularLabel: 'Secret',
        hidden: true,
        actions: { viewAny: true }
      },
      audit: {
        identity: 'audit',
        label: 'Audit entries',
        singularLabel: 'Audit entry',
        actions: { viewAny: false }
      }
    }
  })

  expect(navigation).toEqual({
    actor: {
      id: 'host-user-7',
      email: 'ada@example.com',
      fullName: 'Ada Lovelace',
      role: 'administrator'
    },
    dashboards: [{ id: 'overview', label: 'Content overview', default: true }],
    resources: [
      {
        identity: 'course',
        label: 'Courses',
        singularLabel: 'Course'
      },
      {
        identity: 'lesson',
        label: 'Lessons',
        singularLabel: 'Lesson'
      }
    ]
  })
})
