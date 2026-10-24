// Read-only loopback fixture. Do not expose as a hosted app or runner.
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve('.tmp/ci-component-preview')
const runsFile = path.resolve('tests/fixtures/ci/source-check-runs.json')
function payload(url) {
  return {
    component: 'projects/ci',
    url: url || '/projects/sailsconf/ci',
    version: 'ci-review',
    props: {
      loggedInUser: {
        id: 1,
        fullName: 'Local Reviewer',
        email: 'reviewer@example.test',
        team: { id: 1, name: 'Sailscasts' },
        isGenesisUser: false
      },
      project: { name: 'sailsconf.com', slug: 'sailsconf' },
      environment: { name: 'Production', slug: 'production' },
      workspace: {
        version: 1,
        readOnly: true,
        runner: 'local-pilot',
        runs: JSON.parse(fs.readFileSync(runsFile, 'utf8'))
      }
    }
  }
}
const server = http.createServer((req, res) => {
  if (req.method !== 'GET') {
    res.writeHead(405)
    return res.end('Read-only local preview')
  }
  const url = new URL(req.url, 'http://localhost')
  if (url.pathname === '/api/v1/deployments/active/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache'
    })
    res.write('data: {"deployments":[]}\n\n')
    const timer = setInterval(() => res.write(': preview\n\n'), 15000)
    req.on('close', () => clearInterval(timer))
    return
  }
  if (url.pathname === '/preview-page.json' || req.headers['x-inertia']) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-Inertia': 'true',
      'Cache-Control': 'no-store'
    })
    return res.end(
      JSON.stringify(
        payload(
          url.pathname === '/preview-page.json'
            ? '/projects/sailsconf/ci' + url.search
            : req.url
        )
      )
    )
  }
  if (url.pathname.startsWith('/api/')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end('{"updateAvailable":false}')
  }
  const file = url.pathname.startsWith('/static/')
    ? path.resolve(root, '.' + url.pathname)
    : path.join(root, 'index.html')
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404)
    return res.end()
  }
  const type =
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml'
    }[path.extname(file)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  fs.createReadStream(file).pipe(res)
})
server.listen(56654, '127.0.0.1', () =>
  console.log(
    'Actual Slipway components: http://127.0.0.1:56654/projects/sailsconf/ci'
  )
)
