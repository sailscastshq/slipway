const { test } = require('sounding')

const getDiskSpace = require('../../../../api/helpers/lookout/get-disk-space')

const { parseDiskSpaceOutput, formatBytes } = getDiskSpace._private

test('disk space parser reads the root volume stats from df output', async ({
  expect
}) => {
  const disk =
    parseDiskSpaceOutput(`Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/vda1         41152812  9249376  29765284      24% /
`)

  expect(disk.usedPercent).toBe(24)
  expect(disk.mount).toBe('/')
  expect(disk.availableBytes).toBe(29765284 * 1024)
  expect(disk.available).toBe('28 GB')
  expect(disk.total).toBe('39 GB')
})

test('disk space formatter keeps smaller byte values readable', async ({
  expect
}) => {
  expect(formatBytes(0)).toBe('0 B')
  expect(formatBytes(1536)).toBe('1.5 KB')
  expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
})
