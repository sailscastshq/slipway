const { test } = require('sounding')

test('Content validation checks slugs and JSON before a source write', ({
  sails,
  expect
}) => {
  expect(
    sails.helpers.content.validate({ contentSlug: 'Release Notes' }, [
      'contentSlug'
    ])
  ).toEqual([
    {
      contentSlug: 'Use lowercase letters, numbers, and single hyphens.'
    }
  ])

  expect(
    sails.helpers.content.validate({ raw: '{ not json', fileType: 'json' }, [
      'raw'
    ])
  ).toEqual([{ raw: 'Enter valid JSON before saving.' }])
})

test('Content validation keeps unrelated editor fields quiet', ({
  sails,
  expect
}) => {
  const problems = sails.helpers.content.validate(
    {
      frontmatter: {
        title: 'A valid title',
        'bad\nkey': 'This is not safe to serialize'
      },
      body: 42
    },
    ['frontmatter.title']
  )

  expect(problems).toEqual([])
})
