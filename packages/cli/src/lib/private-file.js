import { open } from 'node:fs/promises'
import { constants } from 'node:fs'

// Never overwrite an existing receipt or capability, including a symlink.
export async function privateFile(path) {
  const handle = await open(
    path,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW || 0),
    0o600
  )
  return {
    async write(value) {
      const bytes = Buffer.from(
        typeof value === 'string'
          ? value
          : `${JSON.stringify(value, null, 2)}\n`
      )
      let offset = 0
      while (offset < bytes.length) {
        const { bytesWritten } = await handle.write(
          bytes,
          offset,
          bytes.length - offset,
          offset
        )
        if (!bytesWritten) throw new Error('Private file could not be written.')
        offset += bytesWritten
      }
      await handle.truncate(bytes.length)
      await handle.sync()
    },
    close: () => handle.close()
  }
}
