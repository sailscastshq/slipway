const page = require('./public-page')
function definitions({ app, projectSlug, environmentSlug }) {
  const base = page.publicPath(app)
  const assets = `${page.prefix(app)}/_slipway/beacon/_assets`
  const internal = page.internalPath(
    { slug: projectSlug },
    { slug: environmentSlug },
    app
  )
  return [
    { matcher: `${assets}/*`, strip: assets },
    { matcher: base, from: base, to: internal },
    { matcher: `${base}/*`, from: base, to: internal }
  ]
}
function handlers(inputs) {
  return definitions(inputs).map((entry) => ({
    handler: 'subroute',
    routes: [
      {
        match: [{ path: [entry.matcher] }],
        handle: [
          entry.strip
            ? { handler: 'rewrite', strip_path_prefix: entry.strip }
            : { handler: 'rewrite', strip_path_prefix: entry.from },
          ...(entry.strip
            ? []
            : [
                {
                  handler: 'rewrite',
                  uri: `${entry.to}{http.request.uri.path}`
                }
              ]),
          {
            handler: 'reverse_proxy',
            upstreams: [{ dial: inputs.controlPlaneUpstream }]
          }
        ]
      }
    ]
  }))
}
function labels(inputs, offset) {
  return definitions(inputs).flatMap((entry, index) => {
    const key = `caddy.handle_${offset + index}`
    return [
      `${key}=${entry.matcher}`,
      `${key}.0_uri=${
        entry.strip
          ? `strip_prefix ${entry.strip}`
          : `replace ${entry.from} ${entry.to}`
      }`,
      `${key}.1_reverse_proxy=${inputs.controlPlaneUpstream}`
    ]
  })
}
module.exports = { handlers, labels }
