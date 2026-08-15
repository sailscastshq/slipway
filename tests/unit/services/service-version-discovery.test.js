const { test } = require('sounding')

const { findSupportedLine } = require('../../../api/lib/service-image-policy')
const {
  discoverServiceVersion,
  getRuntimeVersionCommand
} = require('../../../api/lib/service-version-discovery')

test('Redis version discovery survives current and legacy official images', ({
  expect
}) => {
  expect(getRuntimeVersionCommand('redis')).toEqual([
    'redis-server',
    '--version'
  ])

  const runtime = discoverServiceVersion({
    type: 'redis',
    runtimeOutput: 'Redis server v=8.4.0 sha=00000000:0 malloc=jemalloc',
    container: { Config: { Image: 'redis:latest' } },
    image: {
      Config: {
        Env: [
          'REDIS_DOWNLOAD_URL=https://github.com/redis/redis/archive/refs/tags/8.3.0.tar.gz'
        ]
      },
      RepoTags: ['redis:latest']
    }
  })
  expect(runtime.detectedVersion).toBe('8.4.0')
  expect(runtime.source).toBe('runtime-command')
  expect(findSupportedLine('redis', runtime.detectedVersion)).toBe('8.4')

  const currentImage = discoverServiceVersion({
    type: 'redis',
    container: { Config: { Image: 'redis:latest' } },
    image: {
      Config: {
        Env: [
          'REDIS_DOWNLOAD_URL=https://github.com/redis/redis/archive/refs/tags/8.4.0.tar.gz'
        ]
      },
      RepoTags: ['redis:latest']
    }
  })
  expect(currentImage.detectedVersion).toBe('8.4.0')
  expect(currentImage.source).toBe('image-env:REDIS_DOWNLOAD_URL')

  const legacyImage = discoverServiceVersion({
    type: 'redis',
    container: { Config: { Image: 'redis:latest' } },
    image: {
      Config: { Env: ['REDIS_VERSION=7.2.5'] },
      RepoTags: ['redis:latest']
    }
  })
  expect(legacyImage.detectedVersion).toBe('7.2.5')
  expect(legacyImage.source).toBe('image-env:REDIS_VERSION')
})
