import { createInterface } from 'node:readline'

export function prompt(question, defaultValue = '') {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const suffix = defaultValue ? ` (${defaultValue})` : ''

  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close()
      resolve(answer.trim() || defaultValue)
    })
  })
}

export function promptPassword(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    // Hide input for password
    process.stdout.write(`${question}: `)

    const stdin = process.stdin
    const wasRaw = stdin.isRaw

    if (stdin.isTTY) {
      stdin.setRawMode(true)
    }

    let password = ''

    const onData = (char) => {
      char = char.toString()

      switch (char) {
        case '\n':
        case '\r':
        case '\u0004': // Ctrl+D
          if (stdin.isTTY) {
            stdin.setRawMode(wasRaw)
          }
          stdin.removeListener('data', onData)
          rl.close()
          process.stdout.write('\n')
          resolve(password)
          break
        case '\u0003': // Ctrl+C
          process.exit(1)
          break
        case '\u007F': // Backspace
          password = password.slice(0, -1)
          break
        default:
          password += char
          break
      }
    }

    stdin.on('data', onData)
  })
}

export function confirm(question, defaultValue = true) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const suffix = defaultValue ? ' (Y/n)' : ' (y/N)'

  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close()
      const normalized = answer.trim().toLowerCase()
      if (normalized === '') {
        resolve(defaultValue)
      } else {
        resolve(normalized === 'y' || normalized === 'yes')
      }
    })
  })
}
