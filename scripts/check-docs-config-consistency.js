const fs = require('node:fs')
const path = require('node:path')

const appRoot = path.resolve(__dirname, '..')
const supportedNodeMajor = 22
const supportedNodeRange = `>=${supportedNodeMajor}.0.0`
const failures = []

checkReadmeLinks()
checkNodeSupport()

if (failures.length > 0) {
  console.error('Documentation/config consistency checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log(
  `Documentation links and Node.js ${supportedNodeMajor}+ requirements are consistent.`
)

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
    if (packageJson.engines?.node !== supportedNodeRange) {
      failures.push(
        `${packagePath} must declare engines.node as ${supportedNodeRange}`
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
