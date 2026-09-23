const { test } = require('sounding')
const { ownedImagePaths } = require('../../../api/lib/bearing-update-images')

test('Bearing draft cleanup selects only generated images under its app path', ({
  expect
}) => {
  const directory = 'bearing/teams/1/projects/2/apps/3/updates/assets'
  const filename = '11111111-1111-4111-8111-111111111111.png'
  const body = [
    `![Owned](https://assets.example.test/${directory}/${filename})`,
    `![Other app](https://assets.example.test/bearing/teams/1/projects/2/apps/4/updates/assets/${filename})`,
    `![Other host](https://elsewhere.example.test/${directory}/${filename})`,
    `![Manual URL](https://assets.example.test/${directory}/arbitrary.png)`,
    `A normal link: [image](https://assets.example.test/${directory}/22222222-2222-4222-8222-222222222222.png)`
  ].join('\n\n')

  expect([
    ...ownedImagePaths(body, {
      publicUrl: 'https://assets.example.test',
      directory
    })
  ]).toEqual([`${directory}/${filename}`])
})
