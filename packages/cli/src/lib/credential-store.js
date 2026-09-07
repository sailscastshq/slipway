import fs from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const empty = () => ({ server: '', token: '', user: null, team: null })

export function credentialStore(directory) {
  const file = join(directory, 'config.json')
  function ensureDirectory() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(
        'Credential directory must be a real directory, not a symlink.'
      )
    fs.chmodSync(directory, 0o700)
  }
  return {
    read() {
      ensureDirectory()
      let fd
      try {
        fd = fs.openSync(
          file,
          fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
        )
        if (!fs.fstatSync(fd).isFile() || fs.lstatSync(file).isSymbolicLink())
          throw new Error(
            'Credential file must be a regular file, not a symlink.'
          )
        fs.fchmodSync(fd, 0o600)
        const parsed = JSON.parse(fs.readFileSync(fd, 'utf8'))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : empty()
      } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError)
          return empty()
        throw error
      } finally {
        if (fd !== undefined) fs.closeSync(fd)
      }
    },
    write(config) {
      ensureDirectory()
      const temp = join(directory, `.config-${randomUUID()}.tmp`)
      let fd
      try {
        fd = fs.openSync(temp, 'wx', 0o600)
        fs.writeFileSync(fd, JSON.stringify(config, null, 2) + '\n')
        fs.fsyncSync(fd)
        fs.closeSync(fd)
        fd = undefined
        fs.renameSync(temp, file)
      } finally {
        if (fd !== undefined) fs.closeSync(fd)
        fs.rmSync(temp, { force: true })
      }
    }
  }
}
