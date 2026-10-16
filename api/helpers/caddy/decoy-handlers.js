const decoys = require('../lookout/decoy-config')._private

module.exports = {
  friendlyName: 'Decoy handlers',
  inputs: { apps: { type: 'ref', required: true } },
  exits: { success: { outputType: 'ref' } },
  fn: function ({ apps }) {
    return handlers(apps)
  }
}
const BODY = '{"ok":true,"data":{}}'
function handlers(apps) {
  return apps.flatMap((app) =>
    !app.lookoutDecoys?.enabled
      ? []
      : app.lookoutDecoys.paths.map((path) => ({
          handler: 'subroute',
          routes: [
            {
              match: [
                {
                  path: [decoys.effectivePath(app, path)],
                  method: ['GET', 'HEAD']
                }
              ],
              handle: [
                {
                  handler: 'log_append',
                  key: 'slipway_decoy',
                  value: decoys.token(app, path)
                },
                {
                  handler: 'log_append',
                  key: 'decoy_method',
                  value: '{http.request.method}'
                },
                {
                  handler: 'vars',
                  log_skip: false,
                  access_logger_names: [
                    decoys.logIdentity(app.environment).name
                  ]
                },
                {
                  handler: 'headers',
                  response: {
                    set: {
                      'Content-Type': ['application/json'],
                      'Cache-Control': ['no-store'],
                      'X-Content-Type-Options': ['nosniff']
                    }
                  }
                },
                { handler: 'static_response', status_code: 200, body: BODY }
              ]
            }
          ]
        }))
  )
}
function labels(apps, startIndex) {
  const labels = []
  const enabled = apps.filter((a) => a.lookoutDecoys?.enabled)
  if (!enabled.length) return labels
  const logger = decoys.logIdentity(enabled[0].environment)
  labels.push(
    `caddy.log=${logger.name}`,
    'caddy.log.no_hostname=',
    `caddy.log.output=file ${logger.file}`,
    'caddy.log.output.roll_size=2MiB',
    'caddy.log.output.roll_keep=2',
    'caddy.log.output.roll_keep_for=168h',
    'caddy.log.format=filter',
    'caddy.log.format.wrap=json',
    'caddy.log.format.fields.request=delete',
    'caddy.log.format.fields.resp_headers=delete',
    'caddy.log.format.fields.user_id=delete',
    'caddy.log.sampling.first=5',
    'caddy.log.sampling.thereafter=100'
  )
  // Default to no access logging; only an exact decoy handler opts back in.
  labels.push('caddy.log_skip=')
  let index = startIndex
  for (const app of enabled)
    for (const path of app.lookoutDecoys.paths) {
      const matcher = `decoy${index}`
      const key = `caddy.handle_${index++}`
      labels.push(
        `caddy.@${matcher}.path=${decoys.effectivePath(app, path)}`,
        `caddy.@${matcher}.method=GET HEAD`,
        `${key}=@${matcher}`,
        `${key}.log_name=${logger.name}`,
        `${key}.vars=log_skip false`,
        `${key}.log_append_0=slipway_decoy ${decoys.token(app, path)}`,
        `${key}.log_append_1=decoy_method {http.request.method}`,
        `${key}.header_0=Content-Type application/json`,
        `${key}.header_1=Cache-Control no-store`,
        `${key}.header_2=X-Content-Type-Options nosniff`,
        `${key}.respond=\`${BODY}\` 200`
      )
    }
  return labels
}
module.exports._private = { BODY, handlers, labels }
