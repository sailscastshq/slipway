const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const supportedNodeMajor = 22
const supportedNodeRange = `>=${supportedNodeMajor}.0.0`
const failures = []

async function main() {
  checkReadmeLinks()
  checkNodeSupport()
  const { commands, aliases } = await import(
    '../packages/cli/src/lib/commands.js'
  )
  const known = new Set([...Object.keys(commands), ...Object.keys(aliases)])
  const documents = process.argv.slice(2)
  for (const file of ['README.md', 'packages/cli/README.md', ...documents]) {
    const markdown = fs.readFileSync(path.resolve(appRoot, file), 'utf8')
    for (const match of markdown.matchAll(
      /(?:^\s*(?:\$\s*)?|`)slipway\s+([a-z][a-z:-]*)/gm
    )) {
      if (!known.has(match[1]))
        failures.push(`${file} documents unknown CLI command: ${match[1]}`)
    }
  }
  if (failures.length > 0) {
    console.error('Documentation/config consistency checks failed:')
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  } else {
    console.log(
      `Documentation links, CLI commands, and Node.js ${supportedNodeMajor}+ requirements are consistent.`
    )
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})

function checkReadmeLinks() {
  for (const readmePath of findReadmes(appRoot)) {
    const markdown = fs.readFileSync(readmePath, 'utf8')
    const linkPatterns = [
      /!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g,
      /^\s*\[[^\]]+]:\s*(\S+)/gm,
      /(?:href|src)=["']([^"']+)["']/gi
    ]

    for (const linkPattern of linkPatterns) {
      for (const match of markdown.matchAll(linkPattern)) {
        checkLocalLink(readmePath, match[1])
      }
    }
  }
}

function checkLocalLink(readmePath, target) {
  const rawTarget = target.replace(/^<|>$/g, '')
  if (rawTarget.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(rawTarget)) {
    return
  }

  const targetWithoutAnchor = rawTarget.split(/[?#]/)[0]
  if (!targetWithoutAnchor) return

  if (path.isAbsolute(targetWithoutAnchor)) {
    failures.push(
      `${relative(readmePath)} contains an absolute local link: ${rawTarget}`
    )
    return
  }

  let decodedTarget
  try {
    decodedTarget = decodeURIComponent(targetWithoutAnchor)
  } catch {
    failures.push(
      `${relative(readmePath)} contains an invalid encoded link: ${rawTarget}`
    )
    return
  }

  const resolvedTarget = path.resolve(path.dirname(readmePath), decodedTarget)
  if (!fs.existsSync(resolvedTarget)) {
    failures.push(`${relative(readmePath)} links to missing path: ${rawTarget}`)
  }
}

function checkNodeSupport() {
  const packagePaths = [
    'package.json',
    'packages/cli/package.json',
    'packages/hook/package.json'
  ]

  for (const packagePath of packagePaths) {
    const packageJson = readJson(packagePath)
    const expectedRange =
      packagePath === 'package.json'
        ? '^22.20.0 || >=24.12.0'
        : supportedNodeRange
    if (packageJson.engines?.node !== expectedRange) {
      failures.push(
        `${packagePath} must declare engines.node as ${expectedRange}`
      )
    }
  }

  const workflow = read('.github/workflows/test.yml')
  const workflowVersions = [
    ...workflow.matchAll(/node-version:\s*['"]?(\d+)['"]?/g)
  ].map((match) => Number(match[1]))
  if (
    workflowVersions.length === 0 ||
    workflowVersions.some((version) => version !== supportedNodeMajor)
  ) {
    failures.push(
      `.github/workflows/test.yml must test on Node.js ${supportedNodeMajor}`
    )
  }

  const dockerfile = read('Dockerfile')
  if (
    !new RegExp(`^FROM node:${supportedNodeMajor}(?:-|$)`, 'm').test(dockerfile)
  ) {
    failures.push(`Dockerfile must use the Node.js ${supportedNodeMajor} line`)
  }

  const readme = read('README.md')
  const cliReadme = read('packages/cli/README.md')
  const hookReadme = read('packages/hook/README.md')
  if (!readme.includes(`Node.js ${supportedNodeMajor}+`)) {
    failures.push(`README.md must document Node.js ${supportedNodeMajor}+`)
  }
  if (!cliReadme.includes(`Node.js ${supportedNodeMajor}+`)) {
    failures.push(
      `packages/cli/README.md must document Node.js ${supportedNodeMajor}+`
    )
  }
  if (!hookReadme.includes(`Node.js ${supportedNodeMajor} or newer`)) {
    failures.push(
      `packages/hook/README.md must document Node.js ${supportedNodeMajor} or newer`
    )
  }

  const cliRuntime = read('packages/cli/src/lib/runtime.js')
  if (
    !cliRuntime.includes(
      `export const MINIMUM_NODE_MAJOR = ${supportedNodeMajor}`
    )
  ) {
    failures.push(
      `Slipway CLI must reject runtimes older than Node.js ${supportedNodeMajor}`
    )
  }
}

function findReadmes(directory) {
  const paths = []

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      ['.git', '.tmp', 'node_modules'].includes(entry.name)
    ) {
      continue
    }

    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      paths.push(...findReadmes(entryPath))
    } else if (/^readme\.md$/i.test(entry.name)) {
      paths.push(entryPath)
    }
  }

  return paths
}

function read(relativePath) {
  return fs.readFileSync(path.join(appRoot, relativePath), 'utf8')
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath))
}

function relative(filePath) {
  return path.relative(appRoot, filePath)
}
