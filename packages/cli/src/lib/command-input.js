import { readFile } from 'node:fs/promises'

export async function commandInput(options, positionals = []) {
  if (options.stdin && (positionals.length || options.file))
    throw new Error('--stdin cannot be combined with a command or --file.')
  if (options.file && positionals.length)
    throw new Error('--file cannot be combined with a command.')
  let code
  if (options.stdin) {
    if (process.stdin.isTTY)
      throw new Error('Pipe command input to --stdin or use --file.')
    const chunks = []
    let bytes = 0
    for await (const chunk of process.stdin) {
      bytes += Buffer.byteLength(chunk)
      if (bytes > 64 * 1024) throw new Error('Command input exceeds 64 KiB.')
      chunks.push(Buffer.from(chunk))
    }
    code = Buffer.concat(chunks).toString('utf8')
  } else if (options.file) code = await readFile(options.file, 'utf8')
  else code = positionals.join(' ')
  if (!code?.trim())
    throw new Error('Provide a command, --file <path>, or --stdin.')
  if (Buffer.byteLength(code) > 64 * 1024)
    throw new Error('Command input exceeds 64 KiB.')
  return code
}
